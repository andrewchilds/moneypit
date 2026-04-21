<script lang="ts">
	import { Wallet, AlertCircle, Upload, ArrowRight } from 'lucide-svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import StatsGrid from '$lib/components/StatsGrid.svelte';

	let { data } = $props();

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="dashboard">
	<h1>Dashboard</h1>

	<StatsGrid>
		<StatCard label="Accounts" variant="default">
			{#snippet icon()}<Wallet size={24} />{/snippet}
			{data.stats.accountCount}
		</StatCard>
		<StatCard label="Pending" variant={data.stats.pendingCount > 0 ? 'warning' : 'default'}>
			{#snippet icon()}<AlertCircle size={24} />{/snippet}
			{data.stats.pendingCount}
		</StatCard>
		<StatCard label="Recent Imports" variant="default">
			{#snippet icon()}<Upload size={24} />{/snippet}
			{data.recentImports.length}
		</StatCard>
	</StatsGrid>

	<div class="panels">
		<section class="panel">
			<h2>Quick Actions</h2>
			<div class="quick-actions">
				<a href="/import" class="action-link">
					<Upload size={18} />
					<span>Import Statement</span>
					<ArrowRight size={16} />
				</a>
				<a href="/categorize" class="action-link">
					<AlertCircle size={18} />
					<span>Categorize Transactions</span>
					<ArrowRight size={16} />
				</a>
				<a href="/accounts" class="action-link">
					<Wallet size={18} />
					<span>Manage Accounts</span>
					<ArrowRight size={16} />
				</a>
			</div>
		</section>

		<section class="panel">
			<h2>Accounts by Type</h2>
			{#if Object.keys(data.stats.accountsByType).length > 0}
				<ul class="type-list">
					{#each Object.entries(data.stats.accountsByType) as [type, count] (type)}
						<li>
							<span class="type-name">{type.charAt(0) + type.slice(1).toLowerCase()}</span>
							<span class="type-count">{count}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty-state">No accounts yet. <a href="/accounts">Create one</a></p>
			{/if}
		</section>

		<section class="panel">
			<h2>Recent Imports</h2>
			{#if data.recentImports.length > 0}
				<ul class="import-list">
					{#each data.recentImports as imp (imp.source)}
						<li>
							<span class="import-source">{imp.source}</span>
							<span class="import-date">{formatDate(imp.date)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty-state">No imports yet. <a href="/import">Import a statement</a></p>
			{/if}
		</section>
	</div>
</div>

<style>
	.dashboard {
		max-width: 1200px;
	}

	h1 {
		margin: 0 0 var(--spacing-lg);
		font-size: 24px;
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--spacing-lg);
	}

	.panel {
		padding: var(--spacing-lg);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.panel h2 {
		margin: 0 0 var(--spacing-md);
		font-size: 16px;
		font-weight: 600;
	}

	.quick-actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.action-link {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		text-decoration: none;
		transition: background var(--transition-fast);
	}

	.action-link:hover {
		background: var(--color-bg-hover);
		text-decoration: none;
	}

	.action-link span {
		flex: 1;
	}

	.action-link :global(svg:last-child) {
		color: var(--color-text-muted);
	}

	.type-list,
	.import-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.type-list li,
	.import-list li {
		display: flex;
		justify-content: space-between;
		padding: var(--spacing-sm) 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.type-list li:last-child,
	.import-list li:last-child {
		border-bottom: none;
	}

	.type-count {
		font-weight: 600;
	}

	.import-source {
		font-family: var(--font-mono);
		font-size: 13px;
	}

	.import-date {
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.empty-state {
		color: var(--color-text-muted);
		margin: 0;
	}

	.empty-state a {
		color: var(--color-primary);
	}
</style>
