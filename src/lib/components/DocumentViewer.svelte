<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { Snippet } from "svelte";
	import { ZoomIn, ZoomOut, Maximize2 } from "lucide-svelte";
	import type { PDFDocumentProxy } from "pdfjs-dist";
	import { looksLikeFigure, textInRect, type TextItem, type Rect } from "$lib/documentFigures";
	import { openPdf, pageTextItems } from "$lib/pdf/client";

	export interface Region extends Rect {
		page: number;
	}

	export interface ViewerLine {
		id: string;
		box: string;
		label: string;
		page: number | null;
		x: number | null;
		y: number | null;
		w: number | null;
		h: number | null;
	}

	/** What the user pointed at: a region on a page and the text found there. */
	export interface Pick extends Region {
		text: string;
	}

	interface Props {
		fileUrl: string;
		mimeType: string;
		lines: ViewerLine[];
		/** The line whose highlight should stand out */
		selectedLineId?: string | null;
		/** Set when the user has picked a region; the popover renders beside it */
		pick?: Pick | null;
		popover?: Snippet<[Pick]>;
		onselectline?: (id: string) => void;
	}

	let { fileUrl, mimeType, lines, selectedLineId = null, pick = $bindable(null), popover, onselectline }: Props = $props();

	interface PageState {
		number: number;
		width: number;
		height: number;
		items: TextItem[];
		rendered: boolean;
		rendering: boolean;
	}

	let pages = $state<PageState[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let zoom = $state(1);
	let pdf: PDFDocumentProxy | null = null;
	let container: HTMLDivElement;
	let pageEls: HTMLDivElement[] = [];
	let canvases: HTMLCanvasElement[] = [];
	let observer: IntersectionObserver | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;

	const isPdf = $derived(mimeType === "application/pdf");
	const placedLines = $derived(lines.filter((l) => l.page !== null && l.x !== null));

	onMount(async () => {
		try {
			if (isPdf) await loadPdf();
			else await loadImage();
		} catch (e) {
			loadError = (e as Error).message;
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		observer?.disconnect();
		void pdf?.loadingTask.destroy();
	});

	async function loadPdf() {
		pdf = await openPdf(fileUrl);
		const next: PageState[] = [];
		for (let n = 1; n <= pdf.numPages; n++) {
			const page = await pdf.getPage(n);
			const viewport = page.getViewport({ scale: 1 });
			next.push({ number: n, width: viewport.width, height: viewport.height, items: [], rendered: false, rendering: false });
		}
		pages = next;
		queueMicrotask(observePages);
	}

	async function loadImage() {
		await new Promise<void>((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				pages = [{ number: 1, width: img.naturalWidth, height: img.naturalHeight, items: [], rendered: true, rendering: false }];
				resolve();
			};
			img.onerror = () => reject(new Error("Could not load image"));
			img.src = fileUrl;
		});
	}

	function observePages() {
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const index = pageEls.indexOf(entry.target as HTMLDivElement);
					if (index >= 0) void renderPage(index);
				}
			},
			{ root: container, rootMargin: "400px 0px" }
		);
		for (const el of pageEls) if (el) observer.observe(el);
	}

	async function renderPage(index: number) {
		const state = pages[index];
		const canvas = canvases[index];
		const el = pageEls[index];
		if (!pdf || !state || !canvas || !el || state.rendering) return;
		state.rendering = true;
		try {
			const page = await pdf.getPage(state.number);
			const scale = (el.clientWidth * (window.devicePixelRatio || 1)) / state.width;
			const viewport = page.getViewport({ scale: Math.min(scale, 4) });
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			await page.render({ canvas, viewport }).promise;
			if (state.items.length === 0) state.items = await pageTextItems(page);
			state.rendered = true;
		} finally {
			state.rendering = false;
		}
	}

	/** Re-render visible pages after a zoom or window resize so they stay sharp. */
	function rerenderSoon() {
		if (!isPdf) return;
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			for (const p of pages) p.rendered = false;
			observePages();
		}, 150);
	}

	function setZoom(next: number) {
		zoom = Math.min(3, Math.max(0.5, Math.round(next * 4) / 4));
		rerenderSoon();
	}

	// ---- Pointing at things ----

	let drag = $state<{ page: number; startX: number; startY: number; x: number; y: number } | null>(null);

	function fractions(el: HTMLElement, e: PointerEvent) {
		const r = el.getBoundingClientRect();
		return {
			x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
		};
	}

	function dragRect(): Rect | null {
		if (!drag) return null;
		const x = Math.min(drag.startX, drag.x);
		const y = Math.min(drag.startY, drag.y);
		return { x, y, w: Math.abs(drag.x - drag.startX), h: Math.abs(drag.y - drag.startY) };
	}

	function onPointerDown(e: PointerEvent, pageIndex: number) {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (target.closest(".figure, .line-mark, .popover")) return;
		const el = pageEls[pageIndex];
		const { x, y } = fractions(el, e);
		drag = { page: pageIndex, startX: x, startY: y, x, y };
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// Synthetic events have no active pointer to capture
		}
		pick = null;
	}

	function onPointerMove(e: PointerEvent, pageIndex: number) {
		if (!drag || drag.page !== pageIndex) return;
		const { x, y } = fractions(pageEls[pageIndex], e);
		drag.x = x;
		drag.y = y;
	}

	function onPointerUp(e: PointerEvent, pageIndex: number) {
		if (!drag || drag.page !== pageIndex) return;
		const el = pageEls[pageIndex];
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		const rect = dragRect();
		drag = null;
		if (!rect) return;
		const r = el.getBoundingClientRect();
		// A tiny drag is a click on empty space: just close the popover
		if (rect.w * r.width < 6 || rect.h * r.height < 6) return;
		const page = pages[pageIndex];
		pick = { page: page.number, ...rect, text: textInRect(page.items, rect) };
	}

	function pickItem(pageIndex: number, item: TextItem) {
		const page = pages[pageIndex];
		pick = { page: page.number, x: item.x, y: item.y, w: item.w, h: item.h, text: item.text };
	}

	/** Scroll a line's highlight into view. Exposed for the sidebar. */
	export function scrollToLine(id: string) {
		const el = container?.querySelector<HTMLElement>(`[data-line-id="${id}"]`);
		el?.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	const pct = (v: number) => `${v * 100}%`;
	const popoverOnLeft = (p: Pick) => p.x + p.w > 0.62;
</script>

<svelte:window onresize={rerenderSoon} />

<div class="viewer">
	<div class="toolbar">
		<span class="muted">
			{#if loading}
				Loading…
			{:else if loadError}
				{loadError}
			{:else}
				{pages.length} {pages.length === 1 ? "page" : "pages"} · click a figure or drag a box around one
			{/if}
		</span>
		<div class="zoom">
			<button type="button" onclick={() => setZoom(zoom - 0.25)} aria-label="Zoom out"><ZoomOut size={16} /></button>
			<button type="button" onclick={() => setZoom(1)} aria-label="Fit width"><Maximize2 size={14} /></button>
			<button type="button" onclick={() => setZoom(zoom + 0.25)} aria-label="Zoom in"><ZoomIn size={16} /></button>
			<span class="mono">{Math.round(zoom * 100)}%</span>
		</div>
	</div>

	<div class="pages-scroll" bind:this={container}>
		<div class="pages" style:width={pct(zoom)}>
			{#each pages as page, i (page.number)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="page"
					style:aspect-ratio="{page.width} / {page.height}"
					bind:this={pageEls[i]}
					onpointerdown={(e) => onPointerDown(e, i)}
					onpointermove={(e) => onPointerMove(e, i)}
					onpointerup={(e) => onPointerUp(e, i)}
					onpointercancel={() => (drag = null)}
				>
					{#if isPdf}
						<canvas bind:this={canvases[i]}></canvas>
					{:else}
						<img src={fileUrl} alt="Page {page.number}" draggable="false" />
					{/if}

					<div class="overlay">
						{#each page.items as item, j (j)}
							{#if looksLikeFigure(item.text)}
								<button
									type="button"
									class="figure"
									style:left={pct(item.x)}
									style:top={pct(item.y)}
									style:width={pct(item.w)}
									style:height={pct(item.h)}
									title={item.text}
									aria-label="Use {item.text}"
									onclick={() => pickItem(i, item)}
								></button>
							{/if}
						{/each}

						{#each placedLines.filter((l) => l.page === page.number) as line (line.id)}
							<button
								type="button"
								class="line-mark"
								class:selected={line.id === selectedLineId}
								data-line-id={line.id}
								style:left={pct(line.x!)}
								style:top={pct(line.y!)}
								style:width={pct(line.w!)}
								style:height={pct(line.h!)}
								title="Box {line.box}: {line.label}"
								onclick={() => onselectline?.(line.id)}
							>
								<span class="mark-label">{line.box}</span>
							</button>
						{/each}

						{#if drag && drag.page === i}
							{@const r = dragRect()!}
							<div class="drag-rect" style:left={pct(r.x)} style:top={pct(r.y)} style:width={pct(r.w)} style:height={pct(r.h)}></div>
						{/if}

						{#if pick && pick.page === page.number}
							<div class="pick-rect" style:left={pct(pick.x)} style:top={pct(pick.y)} style:width={pct(pick.w)} style:height={pct(pick.h)}></div>
							{#if popover}
								<div
									class="popover"
									class:left={popoverOnLeft(pick)}
									style:top={pct(pick.y)}
									style:left={popoverOnLeft(pick) ? undefined : `calc(${pct(pick.x + pick.w)} + 8px)`}
									style:right={popoverOnLeft(pick) ? `calc(${pct(1 - pick.x)} + 8px)` : undefined}
								>
									{@render popover(pick)}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		background: var(--color-bg-alt);
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg);
		border-bottom: 1px solid var(--color-border-light);
		font-size: 13px;
	}

	.muted {
		color: var(--color-text-muted);
	}

	.zoom {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.zoom button {
		display: flex;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		cursor: pointer;
		color: var(--color-text);
	}

	.zoom button:hover {
		background: var(--color-bg-hover);
	}

	.zoom .mono {
		min-width: 3.5em;
		text-align: right;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}

	.pages-scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: var(--spacing-md);
	}

	.pages {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		margin: 0 auto;
		min-width: 100%;
	}

	.page {
		position: relative;
		width: 100%;
		background: white;
		box-shadow: var(--shadow-md);
		user-select: none;
		touch-action: none;
		cursor: crosshair;
	}

	.page canvas,
	.page img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}

	.overlay {
		position: absolute;
		inset: 0;
	}

	.figure {
		position: absolute;
		box-sizing: content-box;
		margin: -2px;
		padding: 1px;
		border: 1px solid transparent;
		border-radius: 2px;
		background: transparent;
		cursor: pointer;
	}

	.figure:hover {
		background: rgba(0, 102, 204, 0.18);
		border-color: var(--color-primary);
	}

	.line-mark {
		position: absolute;
		box-sizing: content-box;
		margin: -3px;
		padding: 2px;
		border: 2px solid var(--color-success);
		border-radius: 3px;
		background: rgba(25, 135, 84, 0.16);
		cursor: pointer;
	}

	.line-mark.selected {
		border-color: var(--color-warning);
		background: rgba(255, 193, 7, 0.28);
	}

	.mark-label {
		position: absolute;
		left: -2px;
		bottom: 100%;
		padding: 0 4px;
		font-size: 10px;
		font-weight: 600;
		line-height: 14px;
		color: white;
		background: var(--color-success);
		border-radius: 2px 2px 0 0;
		white-space: nowrap;
	}

	.line-mark.selected .mark-label {
		background: #b8860b;
	}

	.drag-rect,
	.pick-rect {
		position: absolute;
		pointer-events: none;
		border: 2px dashed var(--color-primary);
		background: rgba(0, 102, 204, 0.1);
	}

	.pick-rect {
		border-style: solid;
	}

	.popover {
		position: absolute;
		z-index: 5;
		width: 300px;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		cursor: default;
		user-select: text;
		font-size: 13px;
	}
</style>
