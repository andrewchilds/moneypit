<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		variant?: "primary" | "secondary" | "danger" | "ghost";
		size?: "sm" | "md" | "lg";
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	}

	let { variant = "secondary", size = "md", disabled = false, type = "button", onclick, children }: Props = $props();
</script>

<button class="btn btn-{variant} btn-{size}" {disabled} {type} {onclick}>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		font-weight: 500;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Sizes */
	.btn-sm {
		padding: 0 8px;
		font-size: 12px;
		height: 24px;
	}

	.btn-md {
		padding: 0 12px;
		font-size: 14px;
		height: 36px;
	}

	.btn-lg {
		padding: 0 20px;
		font-size: 16px;
		height: 42px;
	}

	/* Variants */
	.btn-primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
	}

	.btn-secondary {
		background: var(--color-bg);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-bg-alt);
	}

	.btn-danger {
		background: var(--color-danger);
		color: white;
		border-color: var(--color-danger);
	}

	.btn-danger:hover:not(:disabled) {
		background: #bb2d3b;
		border-color: #bb2d3b;
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-text-muted);
		border-color: transparent;
	}

	.btn-ghost:hover:not(:disabled) {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}
</style>
