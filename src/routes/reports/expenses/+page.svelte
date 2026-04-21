<script lang="ts">
	import { ChevronRight, ChevronDown, Receipt } from "lucide-svelte";
	import StackedBarChart from "$lib/components/StackedBarChart.svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import type { PageData } from "./$types";
	import { goto } from "$app/navigation";

	let { data }: { data: PageData } = $props();

	let expandedCategories = $state<Set<string>>(new Set());

	function toggleCategory(path: string) {
		if (expandedCategories.has(path)) {
			expandedCategories.delete(path);
		} else {
			expandedCategories.add(path);
		}
		expandedCategories = new Set(expandedCategories);
	}

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	function formatCurrencyPrecise(value: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(value);
	}

	function handleRangeChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const value = select.value;

		if (value.startsWith("year:")) {
			const year = value.replace("year:", "");
			goto(`/reports/expenses?range=custom&year=${year}`);
		} else {
			goto(`/reports/expenses?range=${value}`);
		}
	}

	// Calculate monthly average
	const monthlyAverage = $derived(
		data.expensesData.monthlyData.length > 0
			? data.expensesData.totalExpenses / data.expensesData.monthlyData.length
			: 0
	);

	// Top category
	const topCategory = $derived(data.expensesData.categoryTree.length > 0 ? data.expensesData.categoryTree[0] : null);

	interface CategoryNode {
		id: string;
		path: string;
		name: string;
		total: number;
		children: CategoryNode[];
	}
</script>

<div class="expenses-page">
	<header class="page-header">
		<h1><a href="/reports">Reports</a> <ChevronRight size={20} /> Expenses</h1>
		<select
			class="range-select"
			value={data.currentPreset === "custom"
				? `year:${new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("year") || ""}`
				: data.currentPreset}
			onchange={handleRangeChange}
		>
			<option value="ytd">{new Date().getFullYear()} YTD</option>
			<option value="last-6-months">Last 6 Months</option>
			<option value="last-12-months">Last 12 Months</option>
			<option value="last-18-months">Last 18 Months</option>
			<optgroup label="By Year">
				{#each data.availableYears as year (year)}
					<option value="year:{year}">{year}</option>
				{/each}
			</optgroup>
		</select>
	</header>

	<StatsGrid>
		<StatCard label="Total Expenses" variant="negative">
			{#snippet icon()}<Receipt size={24} />{/snippet}
			{formatCurrency(data.expensesData.totalExpenses)}
		</StatCard>
		<StatCard label="Monthly Average" variant="default">
			{#snippet icon()}<Receipt size={24} />{/snippet}
			{formatCurrency(monthlyAverage)}
		</StatCard>
		{#if topCategory}
			<StatCard label="Top Category" variant="default">
				{#snippet icon()}<Receipt size={24} />{/snippet}
				<span class="top-category-name">{topCategory.name}</span>
				<span class="top-category-amount">{formatCurrency(topCategory.total)}</span>
			</StatCard>
		{/if}
	</StatsGrid>

	{#if data.expensesData.monthlyData.length === 0}
		<div class="empty-state">
			<p>No expenses found for this period.</p>
			<p>Import transactions to see your expenses breakdown.</p>
		</div>
	{:else}
		<section class="chart-section">
			<div class="section-header">
				<h2>Monthly Expenses</h2>
			</div>
			<StackedBarChart data={data.expensesData.monthlyData} />
		</section>

		<section class="categories-section">
			<h2>Expenses by Category</h2>
			<div class="category-list">
				{#each data.expensesData.categoryTree as category (category.path)}
					{@render categoryRow(category, 0)}
				{/each}
			</div>
		</section>
	{/if}
</div>

{#snippet categoryRow(node: CategoryNode, depth: number)}
	{@const hasChildren = node.children.length > 0}
	{@const isExpanded = expandedCategories.has(node.path)}
	{@const isVirtual = node.id.startsWith("virtual:")}
	{@const percentage = data.expensesData.totalExpenses > 0 ? (node.total / data.expensesData.totalExpenses) * 100 : 0}

	<div class="category-row" style="--depth: {depth}">
		<div class="category-main">
			{#if hasChildren}
				<button
					class="expand-btn"
					onclick={() => toggleCategory(node.path)}
					aria-label={isExpanded ? "Collapse" : "Expand"}
				>
					{#if isExpanded}
						<ChevronDown size={16} />
					{:else}
						<ChevronRight size={16} />
					{/if}
				</button>
			{:else}
				<span class="expand-spacer"></span>
			{/if}

			{#if isVirtual}
				<span class="category-name">{node.name}</span>
			{:else}
				<a href="/accounts/{node.id}" class="category-name category-link">{node.name}</a>
			{/if}
		</div>

		<div class="category-stats">
			<div class="category-bar-wrapper">
				<div class="category-bar" style="width: {Math.min(percentage, 100)}%"></div>
			</div>
			<span class="category-percentage">{percentage.toFixed(1)}%</span>
			<span class="category-amount">{formatCurrencyPrecise(node.total)}</span>
		</div>
	</div>

	{#if hasChildren && isExpanded}
		{#each node.children as child (child.path)}
			{@render categoryRow(child, depth + 1)}
		{/each}
	{/if}
{/snippet}

<style>
	.expenses-page {
		max-width: 900px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.page-header h1 {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
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

	.range-select {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 14px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.top-category-name {
		display: block;
		font-size: 18px;
		font-weight: 600;
	}

	.top-category-amount {
		display: block;
		font-size: 13px;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
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

	.categories-section {
		margin-bottom: var(--spacing-xl);
	}

	.categories-section h2 {
		margin: 0 0 var(--spacing-md);
		font-size: 18px;
	}

	.category-list {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.category-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-md);
		padding-left: calc(var(--spacing-md) + var(--depth) * 20px);
		border-bottom: 1px solid var(--color-border-light);
	}

	.category-row:last-child {
		border-bottom: none;
	}

	.category-row:hover {
		background: var(--color-bg-alt);
	}

	.category-main {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		flex: 1;
		min-width: 0;
	}

	.expand-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.expand-btn:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}

	.expand-spacer {
		width: 24px;
		flex-shrink: 0;
	}

	.category-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.category-link {
		color: var(--color-text);
		text-decoration: none;
	}

	.category-link:hover {
		color: var(--color-primary);
	}

	.category-stats {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex-shrink: 0;
	}

	.category-bar-wrapper {
		width: 100px;
		height: 8px;
		background: var(--color-bg-alt);
		border-radius: 4px;
		overflow: hidden;
	}

	.category-bar {
		height: 100%;
		background: var(--color-primary);
		border-radius: 4px;
		transition: width 0.2s ease;
	}

	.category-percentage {
		font-size: 12px;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		min-width: 45px;
		text-align: right;
	}

	.category-amount {
		font-family: var(--font-mono);
		font-size: 14px;
		min-width: 100px;
		text-align: right;
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

	@media (max-width: 600px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--spacing-sm);
		}

		.category-bar-wrapper {
			display: none;
		}

		.category-stats {
			gap: var(--spacing-sm);
		}
	}
</style>
