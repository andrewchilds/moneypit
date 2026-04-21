<script lang="ts">
	interface Props {
		variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'asset' | 'liability' | 'equity' | 'income' | 'expense';
		size?: 'sm' | 'md';
		text: string;
	}

	let { variant = 'default', size = 'md', text }: Props = $props();
</script>

<span class="badge badge-{variant} badge-{size}">
	{text}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		font-weight: 500;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.badge-sm {
		padding: 1px 6px;
		font-size: 11px;
	}

	.badge-md {
		padding: 2px 8px;
		font-size: 12px;
	}

	.badge-default {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
	}

	.badge-success {
		background: var(--color-success-light);
		color: var(--color-success);
	}

	.badge-warning {
		background: var(--color-warning-light);
		color: #997404;
	}

	.badge-danger {
		background: var(--color-danger-light);
		color: var(--color-danger);
	}

	.badge-info {
		background: var(--color-info-light);
		color: #087990;
	}

	/* Account type badges */
	.badge-asset {
		background: #d1e7dd;
		color: var(--color-asset);
	}

	.badge-liability {
		background: #f8d7da;
		color: var(--color-liability);
	}

	.badge-equity {
		background: #e2d9f3;
		color: var(--color-equity);
	}

	.badge-income {
		background: #cfe2ff;
		color: var(--color-income);
	}

	.badge-expense {
		background: #ffe5d0;
		color: var(--color-expense);
	}
</style>
