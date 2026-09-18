<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { enhance, deserialize } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { ArrowLeft, Briefcase, Crosshair, FileUp, Trash2, X } from "lucide-svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import DocumentViewer, { type Pick } from "$lib/components/DocumentViewer.svelte";
	import { figureInput, parseFigure } from "$lib/documentFigures";
	import type { PageData, ActionData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const doc = $derived(data.document);
	const presetBoxes = $derived(data.preset?.boxes ?? []);
	const lineFor = (box: string) => doc.lines.find((l) => l.box.toLowerCase() === box.toLowerCase());
	const extraLines = $derived(doc.lines.filter((l) => !presetBoxes.some((b) => b.box.toLowerCase() === l.box.toLowerCase())));
	const fileUrl = $derived(doc.file ? `/tax/documents/${doc.id}/file?v=${doc.file.id}` : null);
	// Other forms read from the same file (a consolidated 1099)
	const siblings = $derived(doc.file?.documents.filter((d) => d.id !== doc.id) ?? []);

	// Every row the sidebar shows: preset boxes first, then any others on the document
	const rows = $derived([
		...presetBoxes.map((b) => ({ box: b.box, label: b.label, line: lineFor(b.box) })),
		...extraLines.map((l) => ({ box: l.box, label: l.label, line: l }))
	]);

	// ---- Sidebar: one amount input per box, saved on Enter or blur ----

	let drafts = $state<Record<string, string>>({});
	const dirty = new Set<string>();

	$effect(() => {
		const current = rows;
		untrack(() => {
			const next: Record<string, string> = {};
			for (const row of current) next[row.box] = dirty.has(row.box) ? drafts[row.box] : figureInput(row.line?.amount);
			drafts = next;
		});
	});

	let activeBox = $state<string | null>(null);
	let selectedLineId = $state<string | null>(null);
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);
	let viewer: DocumentViewer | undefined = $state();

	async function post(action: string, fields: Record<string, string>): Promise<boolean> {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
		busy = true;
		errorMsg = null;
		try {
			const res = await fetch(`?/${action}`, { method: "POST", body, headers: { "x-sveltekit-action": "true" } });
			const result = deserialize(await res.text());
			if (result.type === "failure") {
				errorMsg = (result.data as { error?: string })?.error ?? "Something went wrong";
				return false;
			}
			if (result.type === "error") {
				errorMsg = result.error?.message ?? "Something went wrong";
				return false;
			}
			await invalidateAll();
			return true;
		} finally {
			busy = false;
		}
	}

	async function saveBox(box: string, label: string) {
		if (!dirty.has(box)) return;
		const value = (drafts[box] ?? "").trim();
		const line = lineFor(box);
		dirty.delete(box);
		if (value === "") {
			if (line) await post("deleteLine", { id: line.id });
			return;
		}
		if (line && figureInput(line.amount) === figureInput(parseFigure(value))) return;
		await post("addLine", { box, label, amount: value });
	}

	async function setCategory(box: string, label: string, category: string) {
		const line = lineFor(box);
		if (!line) return;
		await post("addLine", { box, label, amount: figureInput(line.amount), category });
	}

	async function deleteLine(id: string) {
		if (selectedLineId === id) selectedLineId = null;
		await post("deleteLine", { id });
	}

	function arm(box: string) {
		activeBox = box;
		const line = lineFor(box);
		selectedLineId = line?.id ?? null;
	}

	function onRowKeydown(e: KeyboardEvent, box: string, label: string) {
		if (e.key === "Enter") {
			e.preventDefault();
			void saveBox(box, label).then(() => focusNextRow(box));
		}
	}

	function focusNextRow(box: string) {
		const index = rows.findIndex((r) => r.box === box);
		const next = rows[index + 1];
		if (next) document.getElementById(`amount-${next.box}`)?.focus();
	}

	// Another box beyond the form's known ones
	let newBox = $state("");
	let newLabel = $state("");
	let newAmount = $state("");

	async function addExtra() {
		if (!newBox.trim() || !newAmount.trim()) return;
		if (await post("addLine", { box: newBox, label: newLabel, amount: newAmount })) {
			newBox = "";
			newLabel = "";
			newAmount = "";
		}
	}

	// ---- Picking figures off the file ----

	let pick = $state<Pick | null>(null);
	let pickBox = $state("");
	let pickCustomBox = $state("");
	let pickAmount = $state("");
	let pickCategory = $state("");
	let pickAmountEl = $state<HTMLInputElement | undefined>();

	const nextEmptyBox = (after?: string) =>
		presetBoxes.find((b) => b.box !== after && !lineFor(b.box))?.box ?? presetBoxes[0]?.box ?? "";

	$effect(() => {
		if (!pick) return;
		const figure = parseFigure(pick.text);
		pickAmount = figure === null ? "" : figureInput(Math.abs(figure));
		pickBox = activeBox ?? nextEmptyBox();
		if (!presetBoxes.some((b) => b.box === pickBox)) {
			pickCustomBox = pickBox;
			pickBox = "__other";
		} else {
			pickCustomBox = "";
		}
		pickCategory = "";
		queueMicrotask(() => {
			pickAmountEl?.focus();
			pickAmountEl?.select();
		});
	});

	async function savePick() {
		if (!pick) return;
		const box = pickBox === "__other" ? pickCustomBox.trim() : pickBox;
		if (!box || !pickAmount.trim()) return;
		const label = presetBoxes.find((b) => b.box === box)?.label ?? lineFor(box)?.label ?? "";
		const region = { page: String(pick.page), x: String(pick.x), y: String(pick.y), w: String(pick.w), h: String(pick.h) };
		const saved = await post("addLine", { box, label, amount: pickAmount, category: pickCategory, ...region });
		if (saved) {
			pick = null;
			selectedLineId = lineFor(box)?.id ?? null;
			activeBox = nextEmptyBox(box) || null;
		}
	}

	function onPickKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			void savePick();
		} else if (e.key === "Escape") {
			pick = null;
		}
	}

	function selectLine(id: string) {
		const line = doc.lines.find((l) => l.id === id);
		if (!line) return;
		selectedLineId = id;
		activeBox = line.box;
		document.getElementById(`amount-${line.box}`)?.focus();
	}

	function locate(id: string) {
		selectedLineId = id;
		viewer?.scrollToLine(id);
	}

	// Opened from the tax report on a particular line (?line=<id>): select it,
	// arm its box, and scroll the file to where the figure was read from.
	const requestedLine = page.url.searchParams.get("line");
	let scrollPending = !!requestedLine;

	onMount(() => {
		const line = requestedLine ? doc.lines.find((l) => l.id === requestedLine) : undefined;
		if (!line) {
			scrollPending = false;
			return;
		}
		selectedLineId = line.id;
		activeBox = line.box;
		if (!doc.file) document.getElementById(`amount-${line.box}`)?.focus();
	});

	function onViewerReady() {
		if (!scrollPending || !selectedLineId) return;
		scrollPending = false;
		viewer?.scrollToLine(selectedLineId);
	}

	// ---- File attach / replace ----

	let attachForm = $state<HTMLFormElement | undefined>();

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<svelte:head>
	<title>{doc.formType} from {doc.issuer} · {doc.year}</title>
</svelte:head>

<div class="annotate-page">
	<header class="page-header">
		<div class="title">
			<a href="/tax/{doc.year}?tab=documents#doc-{doc.id}" class="back"><ArrowLeft size={16} /> Tax prep {doc.year}</a>
			<h1>
				<span class="mono form-type">{doc.formType}</span>
				{doc.issuer}
				{#if doc.account}<span class="muted">· {doc.account.path}</span>{/if}
				{#if doc.business}<span class="business-tag"><Briefcase size={12} /> {doc.business.name}</span>{/if}
			</h1>
			{#if siblings.length > 0}
				<p class="siblings muted small">
					Also in this file:
					{#each siblings as sibling (sibling.id)}
						<a href="/tax/documents/{sibling.id}"><span class="mono">{sibling.formType}</span> {sibling.issuer}</a>
					{/each}
				</p>
			{/if}
		</div>
		<div class="header-actions">
			{#if doc.file}
				<form method="POST" action="?/addFromFile" use:enhance>
					<select
						class="add-form-select"
						name="formType"
						title="Add another form read from this file"
						onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
					>
						<option value="">Add another form from this file…</option>
						{#each data.formTypes as t (t.formType)}
							<option value={t.formType}>{t.formType} · {t.name}</option>
						{/each}
					</select>
				</form>
			{/if}
			<form
				method="POST"
				action="?/attachFile"
				enctype="multipart/form-data"
				bind:this={attachForm}
				use:enhance={() =>
					async ({ update }) => {
						await update();
					}}
			>
				<label class="file-button">
					<FileUp size={14} />
					{doc.file ? "Replace file" : "Attach PDF or image"}
					<input type="file" name="file" accept="application/pdf,image/*" onchange={() => attachForm?.requestSubmit()} />
				</label>
			</form>
			{#if doc.file}
				<form method="POST" action="?/removeFile" use:enhance title={siblings.length > 0 ? "The file stays with the other forms read from it" : undefined}>
					<Button variant="ghost" size="sm" type="submit">
						<X size={14} />
						{siblings.length > 0 ? "Unlink file" : "Remove file"}
					</Button>
				</form>
			{/if}
		</div>
	</header>

	{#if form?.error || errorMsg}
		<div class="error-banner">{form?.error ?? errorMsg}</div>
	{/if}

	<div class="workspace">
		<div class="file-pane">
			{#if fileUrl && doc.file}
				{#key doc.file.id}
					<DocumentViewer
						bind:this={viewer}
						{fileUrl}
						mimeType={doc.file.mimeType}
						lines={doc.lines}
						{selectedLineId}
						bind:pick
						onselectline={selectLine}
						onready={onViewerReady}
					>
						{#snippet popover(p: Pick)}
							<div class="pick-form" role="dialog" aria-label="Save figure" tabindex="-1" onkeydown={onPickKeydown}>
								{#if p.text}
									<div class="pick-text" title={p.text}>“{p.text}”</div>
								{:else}
									<div class="pick-text muted">No text here. Type the amount.</div>
								{/if}
								<label>
									<span>Box</span>
									<select bind:value={pickBox}>
										{#each presetBoxes as b (b.box)}
											<option value={b.box}>{b.box} — {b.label}{lineFor(b.box) ? " ✓" : ""}</option>
										{/each}
										<option value="__other">Other…</option>
									</select>
								</label>
								{#if pickBox === "__other"}
									<label>
										<span>Box code</span>
										<input bind:value={pickCustomBox} placeholder="e.g. 14" />
									</label>
								{/if}
								<label>
									<span>Amount</span>
									<input bind:this={pickAmountEl} bind:value={pickAmount} inputmode="decimal" placeholder="0.00" />
								</label>
								<label>
									<span>Tax category</span>
									<select bind:value={pickCategory}>
										<option value="">Guess from the box</option>
										<option value="none">Not mapped</option>
										{#each data.taxCategories as c (c.id)}
											<option value={c.id}>{c.name}</option>
										{/each}
									</select>
								</label>
								<div class="pick-actions">
									<Button variant="secondary" size="sm" onclick={() => (pick = null)}>Cancel</Button>
									<Button variant="primary" size="sm" onclick={savePick} disabled={busy}>Save</Button>
								</div>
							</div>
						{/snippet}
					</DocumentViewer>
				{/key}
			{:else}
				<div class="dropzone">
					<FileUp size={32} />
					<p><strong>Attach the {doc.formType}</strong> as a PDF or image to read figures straight off it.</p>
					<p class="muted">Click a number on the page, or drag a box around it, and it lands in the form on the right. You can also type the amounts in without a file.</p>
					<label class="file-button primary">
						<FileUp size={14} /> Choose file
						<input
							type="file"
							name="file"
							accept="application/pdf,image/*"
							form="attach-form"
							onchange={() => (document.getElementById("attach-form") as HTMLFormElement | null)?.requestSubmit()}
						/>
					</label>
					{#if data.otherFiles.length > 0}
						<form method="POST" action="?/linkFile" use:enhance>
							<select name="fileId" class="add-form-select" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
								<option value="">Or read it from a file already on hand…</option>
								{#each data.otherFiles as file (file.id)}
									<option value={file.id}>{file.filename} · {file.documents.map((d) => `${d.formType} ${d.issuer}`).join(", ")}</option>
								{/each}
							</select>
						</form>
					{/if}
				</div>
			{/if}
		</div>

		<aside class="form-pane">
			<div class="form-pane-header">
				<h2>{data.preset?.name ?? doc.formType}</h2>
				{#if doc.file}
					<span class="muted small">{doc.file.filename} · {formatSize(doc.file.size)}</span>
				{/if}
			</div>
			<p class="muted small">
				{#if doc.file}
					Click a box to arm it, then click its figure on the form. Or type amounts directly.
				{:else}
					Type each box's amount. Enter moves to the next box.
				{/if}
			</p>

			<div class="rows">
				{#each rows as row (row.box)}
					{@const line = row.line}
					<div class="row" class:active={activeBox === row.box} class:filled={!!line}>
						<button type="button" class="box-code mono" onclick={() => arm(row.box)} title="Arm box {row.box}">
							{row.box}
						</button>
						<div class="row-main">
							<label for="amount-{row.box}" class="row-label" title={row.label}>{row.label}</label>
							{#if activeBox === row.box && line}
								<select
									class="category-select"
									value={line.taxCategoryId ?? "none"}
									onchange={(e) => setCategory(row.box, row.label, (e.currentTarget as HTMLSelectElement).value)}
								>
									<option value="none">Not mapped</option>
									{#each data.taxCategories as c (c.id)}
										<option value={c.id}>{c.name}{c.scheduleRef ? ` (${c.scheduleRef})` : ""}</option>
									{/each}
								</select>
							{:else if line}
								<span class="category small" class:muted={!line.taxCategory}>{line.taxCategory?.name ?? "not mapped"}</span>
							{/if}
						</div>
						<input
							id="amount-{row.box}"
							class="amount-input mono"
							inputmode="decimal"
							placeholder="—"
							bind:value={drafts[row.box]}
							oninput={() => dirty.add(row.box)}
							onfocus={() => arm(row.box)}
							onblur={() => saveBox(row.box, row.label)}
							onkeydown={(e) => onRowKeydown(e, row.box, row.label)}
						/>
						<div class="row-actions">
							{#if line?.page}
								<button type="button" class="icon-button" title="Show on the form" onclick={() => locate(line.id)}>
									<Crosshair size={14} />
								</button>
							{/if}
							{#if line}
								<button type="button" class="icon-button" title="Remove box {row.box}" onclick={() => deleteLine(line.id)}>
									<Trash2 size={14} />
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<div class="extra">
				<span class="small muted">Another box</span>
				<div class="extra-inputs">
					<input class="mono" placeholder="Box" bind:value={newBox} aria-label="Box code" />
					<input placeholder="Label" bind:value={newLabel} aria-label="Label" />
					<input class="mono" inputmode="decimal" placeholder="0.00" bind:value={newAmount} aria-label="Amount"
						onkeydown={(e) => e.key === "Enter" && addExtra()} />
					<Button size="sm" variant="secondary" onclick={addExtra} disabled={!newBox.trim() || !newAmount.trim()}>Add</Button>
				</div>
			</div>
		</aside>
	</div>

	<!-- Hidden host so the dropzone's file input can submit the attach action -->
	<form id="attach-form" method="POST" action="?/attachFile" enctype="multipart/form-data" hidden use:enhance></form>
</div>

<style>
	.annotate-page {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		height: calc(100vh - 2 * var(--spacing-lg));
		min-height: 480px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--spacing-md);
	}

	.title {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 13px;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.back:hover {
		color: var(--color-primary);
	}

	.page-header h1 {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin: 0;
		font-size: 22px;
	}

	.form-type {
		padding: 2px 8px;
		font-size: 14px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-alt);
	}

	.mono {
		font-family: var(--font-mono);
	}

	.muted {
		color: var(--color-text-muted);
		font-weight: normal;
	}

	.small {
		font-size: 12px;
	}

	.business-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 8px;
		font-size: 12px;
		font-weight: 500;
		border-radius: var(--radius-sm);
		background: var(--color-primary-light, var(--color-bg-alt));
		color: var(--color-primary);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.siblings {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin: 0;
	}

	.siblings a {
		color: var(--color-primary);
		text-decoration: none;
	}

	.add-form-select {
		max-width: 260px;
		padding: 6px 8px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
	}

	.file-button {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: 6px 12px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.file-button:hover {
		background: var(--color-bg-hover);
	}

	.file-button.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.file-button input {
		display: none;
	}

	.error-banner {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-danger-light);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 380px;
		gap: var(--spacing-md);
		flex: 1;
		min-height: 0;
	}

	.file-pane {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.dropzone {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xl);
		text-align: center;
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.dropzone p {
		max-width: 420px;
		margin: 0;
	}

	.dropzone strong {
		color: var(--color-text);
	}

	.form-pane {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-height: 0;
		padding: var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		overflow-y: auto;
	}

	.form-pane-header {
		display: flex;
		flex-direction: column;
	}

	.form-pane h2 {
		margin: 0;
		font-size: 16px;
	}

	.form-pane p {
		margin: 0;
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr) 110px 48px;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 6px 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.row.active {
		background: var(--color-primary-light);
		margin: 0 calc(-1 * var(--spacing-sm));
		padding-left: var(--spacing-sm);
		padding-right: var(--spacing-sm);
		border-radius: var(--radius-sm);
	}

	.box-code {
		padding: 3px 0;
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.row.filled .box-code {
		background: var(--color-success-light);
		border-color: var(--color-success);
		color: var(--color-success);
	}

	.row.active .box-code {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.row-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.row-label {
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.category {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-text-muted);
	}

	.category-select {
		max-width: 100%;
		font-size: 12px;
		padding: 1px 2px;
	}

	.amount-input {
		width: 100%;
		padding: 4px 6px;
		text-align: right;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.amount-input:focus {
		outline: 2px solid var(--color-primary);
		outline-offset: -1px;
	}

	.row-actions {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
	}

	.icon-button {
		display: flex;
		padding: 3px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.icon-button:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}

	.extra {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding-top: var(--spacing-sm);
	}

	.extra-inputs {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr) 90px auto;
		gap: var(--spacing-xs);
	}

	.extra-inputs input {
		min-width: 0;
		padding: 4px 6px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.pick-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.pick-text {
		font-size: 12px;
		font-style: italic;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pick-form label {
		display: grid;
		grid-template-columns: 90px minmax(0, 1fr);
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 12px;
	}

	.pick-form input,
	.pick-form select {
		min-width: 0;
		padding: 4px 6px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.pick-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-xs);
		padding-top: var(--spacing-xs);
	}
</style>
