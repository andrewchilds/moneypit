<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		icon?: Snippet;
		variant?: 'default' | 'positive' | 'negative' | 'warning' | 'liability';
		/** Makes the card a link (to the page or tab the figure summarizes) */
		href?: string;
		children: Snippet;
	}

	let { label, icon, variant = 'default', href, children }: Props = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="stat-card {variant}" class:link={!!href} data-sveltekit-noscroll>
	{#if icon}
		<div class="stat-icon">
			{@render icon()}
		</div>
	{/if}
	<div class="stat-content">
		<span class="stat-value">{@render children()}</span>
		<span class="stat-label">{label}</span>
	</div>
</svelte:element>

<style>
	.stat-card {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-lg);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.stat-card.link {
		color: inherit;
		text-decoration: none;
	}

	.stat-card.link:hover {
		border-color: var(--color-primary);
	}

	.stat-card.positive {
		border-color: var(--color-success);
		background: var(--color-success-light, var(--color-bg));
	}

	.stat-card.negative {
		border-color: var(--color-danger);
		background: var(--color-danger-light, var(--color-bg));
	}

	.stat-card.warning {
		border-color: var(--color-warning);
		background: var(--color-warning-light);
	}

	.stat-card.liability .stat-value {
		color: var(--color-danger);
	}

	.stat-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: var(--color-bg-alt);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
	}

	.stat-card.positive .stat-icon {
		background: var(--color-success);
		color: white;
	}

	.stat-card.negative .stat-icon {
		background: var(--color-danger);
		color: white;
	}

	.stat-card.warning .stat-icon {
		background: var(--color-warning);
		color: white;
	}

	.stat-content {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 20px;
		font-weight: 700;
		line-height: 1.2;
		font-family: var(--font-mono);
	}

	.stat-label {
		color: var(--color-text-muted);
		font-size: 14px;
	}
</style>
