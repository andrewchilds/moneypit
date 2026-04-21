<script lang="ts">
	import { Wallet, CreditCard, TrendingUp, ChevronRight } from "lucide-svelte";
	import StackedBarChart from "$lib/components/StackedBarChart.svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type AssetGrouping = "assetType" | "account";
	let assetGrouping: AssetGrouping = $state("assetType");
	let showRunway = $state(false);

	const assetsData = $derived(
		assetGrouping === "assetType" ? data.netWorthData.assets.byAssetType : data.netWorthData.assets.byAccount
	);

	const liabilitiesData = $derived(data.netWorthData.liabilities.byAccount);

	// Calculate current totals for summary
	const currentAssets = $derived(assetsData.length > 0 ? assetsData[assetsData.length - 1].total : 0);
	const currentLiabilities = $derived(
		liabilitiesData.length > 0 ? liabilitiesData[liabilitiesData.length - 1].total : 0
	);
	const currentNetWorth = $derived(currentAssets - currentLiabilities);

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}
</script>

<div class="net-worth-page">
	<header class="page-header">
		<h1><a href="/reports">Reports</a> <ChevronRight size={20} /> Net Worth</h1>
	</header>

	<StatsGrid>
		<StatCard label="Total Assets" variant="default">
			{#snippet icon()}<Wallet size={24} />{/snippet}
			{formatCurrency(currentAssets)}
		</StatCard>
		<StatCard label="Total Liabilities" variant="liability">
			{#snippet icon()}<CreditCard size={24} />{/snippet}
			{formatCurrency(currentLiabilities)}
		</StatCard>
		<StatCard label="Net Worth" variant={currentNetWorth >= 0 ? "positive" : "negative"}>
			{#snippet icon()}<TrendingUp size={24} />{/snippet}
			{formatCurrency(currentNetWorth)}
		</StatCard>
	</StatsGrid>

	{#if assetsData.length === 0 && liabilitiesData.length === 0}
		<div class="empty-state">
			<p>No asset or liability transactions found.</p>
			<p>Import transactions to see your net worth over time.</p>
		</div>
	{:else}
		<section class="chart-section">
			<div class="section-header">
				<h2>Assets Over Time</h2>
				<div class="controls">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={showRunway} />
						Show Projection
					</label>
					<div class="toggle-group">
						<button
							class="toggle-btn"
							class:active={assetGrouping === "assetType"}
							onclick={() => (assetGrouping = "assetType")}
						>
							By Type
						</button>
						<button
							class="toggle-btn"
							class:active={assetGrouping === "account"}
							onclick={() => (assetGrouping = "account")}
						>
							By Account
						</button>
					</div>
				</div>
			</div>
			{#if assetsData.length > 0}
				<StackedBarChart data={assetsData} {showRunway} />
			{:else}
				<p class="no-data">No asset data available.</p>
			{/if}
		</section>

		<section class="chart-section">
			<div class="section-header">
				<h2>Liabilities Over Time</h2>
			</div>
			{#if liabilitiesData.length > 0}
				<StackedBarChart data={liabilitiesData} />
			{:else}
				<p class="no-data">No liability data available.</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.net-worth-page {
		max-width: 900px;
	}

	.page-header h1 {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0 0 var(--spacing-lg);
		font-size: 24px;
	}

	.page-header h1 a {
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.page-header h1 a:hover {
		color: var(--color-primary);
	}

	.page-header h1 :global(svg) {
		color: var(--color-text-muted);
	}

	.chart-section {
		margin-bottom: var(--spacing-xl);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.section-header h2 {
		margin: 0;
		font-size: 18px;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 13px;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.checkbox-label input {
		cursor: pointer;
	}

	.toggle-group {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.toggle-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.toggle-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.toggle-btn:hover {
		background: var(--color-bg-alt);
	}

	.toggle-btn.active {
		background: var(--color-primary);
		color: white;
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-xl);
		color: var(--color-text-muted);
		background: var(--color-bg-alt);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin: var(--spacing-xs) 0;
	}

	.no-data {
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--spacing-lg);
	}

	@media (max-width: 600px) {
		.section-header {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--spacing-sm);
		}
	}
</style>
