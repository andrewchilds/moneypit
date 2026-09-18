<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A styled tooltip on hover or keyboard focus. Wrap the trigger:
	 *
	 *   <Tooltip text="Plain sentence."><button>…</button></Tooltip>
	 *   <Tooltip><button>…</button>{#snippet content()}<strong>Rich</strong> text{/snippet}</Tooltip>
	 *
	 * The popup is fixed-positioned from the trigger's rectangle, so it is
	 * not clipped by scrolling or overflow containers, and flips above the
	 * trigger when there is no room below.
	 */
	interface Props {
		/** Plain text, when no `content` snippet is given */
		text?: string;
		/** Rich content */
		content?: Snippet;
		/** The trigger */
		children: Snippet;
		placement?: 'bottom' | 'top';
		/** Milliseconds of hover before the tooltip shows */
		delay?: number;
		maxWidth?: number;
	}

	let { text, content, children, placement = 'bottom', delay = 250, maxWidth = 320 }: Props = $props();

	const id = `tooltip-${Math.random().toString(36).slice(2, 9)}`;
	let trigger = $state<HTMLElement | undefined>();
	let popup = $state<HTMLElement | undefined>();
	let open = $state(false);
	let position = $state({ left: 0, top: 0, above: false });
	let timer: ReturnType<typeof setTimeout> | undefined;

	const gap = 6;
	const margin = 8;

	function place() {
		if (!trigger || !popup) return;
		const t = trigger.getBoundingClientRect();
		const p = popup.getBoundingClientRect();
		const fitsBelow = window.innerHeight - t.bottom - gap - margin >= p.height;
		const fitsAbove = t.top - gap - margin >= p.height;
		const above = placement === 'top' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
		const top = above ? t.top - gap - p.height : t.bottom + gap;
		const left = Math.min(Math.max(margin, t.left + t.width / 2 - p.width / 2), window.innerWidth - p.width - margin);
		position = { left, top, above };
	}

	function show() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			open = true;
			// Place once the popup has been rendered and measured
			requestAnimationFrame(place);
		}, delay);
	}

	function hide() {
		clearTimeout(timer);
		open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') hide();
	}

	$effect(() => {
		if (!open) return;
		const onScroll = () => hide();
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onScroll);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="tooltip-trigger"
	bind:this={trigger}
	aria-describedby={open ? id : undefined}
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
	onkeydown={onKeydown}
>
	{@render children()}
</span>

{#if open && (content || text)}
	<div
		{id}
		role="tooltip"
		class="tooltip"
		class:above={position.above}
		bind:this={popup}
		style:left="{position.left}px"
		style:top="{position.top}px"
		style:max-width="{maxWidth}px"
	>
		{#if content}
			{@render content()}
		{:else}
			{text}
		{/if}
	</div>
{/if}

<style>
	.tooltip-trigger {
		display: inline-flex;
		vertical-align: middle;
	}

	.tooltip {
		position: fixed;
		z-index: 1000;
		padding: 6px 10px;
		font-size: 12px;
		font-weight: 400;
		line-height: 1.45;
		color: var(--color-bg);
		background: var(--color-text);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		pointer-events: none;
		white-space: normal;
		text-align: left;
	}

	.tooltip :global(p) {
		margin: 0;
	}

	.tooltip :global(p + p) {
		margin-top: 4px;
	}
</style>
