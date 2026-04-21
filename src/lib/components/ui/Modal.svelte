<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import { scale, fade } from 'svelte/transition';

	interface Props {
		open: boolean;
		title?: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { open = $bindable(), title, onclose, children, footer }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onclose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-backdrop" role="presentation" onclick={handleBackdropClick} transition:fade={{ duration: 150 }}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby={title ? 'modal-title' : undefined} transition:scale={{ duration: 150, start: 0.95 }}>
			{#if title}
				<div class="modal-header">
					<h2 id="modal-title">{title}</h2>
					<button class="close-btn" onclick={onclose} aria-label="Close">
						<X size={20} />
					</button>
				</div>
			{/if}
			<div class="modal-body">
				{@render children()}
			</div>
			{#if footer}
				<div class="modal-footer">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--color-bg);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		max-width: 500px;
		width: 90%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border-light);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.close-btn:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.modal-body {
		padding: var(--spacing-md);
		overflow-y: auto;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}
</style>
