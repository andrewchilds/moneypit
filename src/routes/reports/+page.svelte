<script lang="ts">
	import { TrendingUp, FileText, Receipt } from 'lucide-svelte';
</script>

<div class="reports-page">
	<header class="page-header">
		<h1>Reports</h1>
	</header>

	<div class="report-grid">
		<a href="/reports/net-worth" class="report-card">
			<TrendingUp size={32} strokeWidth={1.5} />
			<h3>Net Worth</h3>
			<p>Assets and liabilities over time</p>
		</a>

		<a href="/reports/expenses" class="report-card">
			<Receipt size={32} strokeWidth={1.5} />
			<h3>Expenses</h3>
			<p>Spending breakdown by category</p>
		</a>

		<a href="/reports/tax" class="report-card">
			<FileText size={32} strokeWidth={1.5} />
			<h3>Tax Report</h3>
			<p>Schedule C and self-employment taxes</p>
		</a>
	</div>
</div>

<style>
	.reports-page {
		max-width: 800px;
	}

	.page-header h1 {
		margin: 0 0 var(--spacing-lg);
		font-size: 24px;
	}

	.report-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--spacing-md);
	}

	.report-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--spacing-lg);
		text-align: center;
		background: var(--color-bg-alt);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
		text-decoration: none;
		color: inherit;
		transition: all 0.15s;
	}

	.report-card:not(.disabled):hover {
		border-color: var(--color-primary);
		background: var(--color-bg);
	}

	.report-card h3 {
		margin: var(--spacing-sm) 0 var(--spacing-xs);
		font-size: 16px;
	}

	.report-card p {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-muted);
	}
</style>
