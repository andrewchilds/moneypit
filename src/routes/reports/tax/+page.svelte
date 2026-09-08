<script lang="ts">
	import { ChevronRight, ChevronDown, DollarSign, FileText, AlertTriangle, Info, TrendingUp, Briefcase } from "lucide-svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import type { PageData } from "./$types";
	import { goto } from "$app/navigation";

	let { data }: { data: PageData } = $props();

	type Section = PageData["taxData"]["sections"][number];
	type Category = Section["incomeCategories"][number];

	let expandedCategories = $state<Set<string>>(new Set());

	const isExpandable = (category: Category) => category.accounts.length > 1 || category.documentLines.length > 0;

	const openItems = $derived(data.taxData.openQuestions + data.taxData.missingDocuments);

	function toggleCategory(id: string) {
		if (expandedCategories.has(id)) {
			expandedCategories.delete(id);
		} else {
			expandedCategories.add(id);
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

	function handleYearChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		goto(`/reports/tax?year=${select.value}`);
	}

	const hasUncategorized = $derived(
		data.taxData.uncategorizedExpenses.length > 0 || data.taxData.uncategorizedIncome.length > 0
	);

	const uncategorizedTotal = $derived(
		data.taxData.uncategorizedExpenses.reduce((sum, a) => sum + a.total, 0) +
		data.taxData.uncategorizedIncome.reduce((sum, a) => sum + a.total, 0)
	);

	// Compute totals from all sections, using document figures where they exist
	const totalIncome = $derived(
		data.taxData.sections.reduce((sum, s) => sum + s.reportedIncome, 0)
	);
	const totalExpenses = $derived(
		data.taxData.sections.reduce((sum, s) => sum + s.reportedExpenses, 0)
	);
	const netAmount = $derived(totalIncome - totalExpenses);
</script>

<div class="tax-report-page">
	<header class="page-header">
		<h1><a href="/reports">Reports</a> <ChevronRight size={20} /> Tax Report</h1>
		<select class="year-select" value={data.taxData.year} onchange={handleYearChange}>
			{#each data.availableYears as year (year)}
				<option value={year}>{year}</option>
			{/each}
		</select>
	</header>

	<StatsGrid>
		<StatCard label="Total Income" variant="positive">
			{#snippet icon()}<DollarSign size={24} />{/snippet}
			{formatCurrency(totalIncome)}
		</StatCard>
		<StatCard label="Total Expenses" variant="negative">
			{#snippet icon()}<FileText size={24} />{/snippet}
			{formatCurrency(totalExpenses)}
		</StatCard>
		<StatCard label="Net" variant={netAmount >= 0 ? "positive" : "negative"}>
			{#snippet icon()}<TrendingUp size={24} />{/snippet}
			{formatCurrency(netAmount)}
		</StatCard>
	</StatsGrid>

	{#if hasUncategorized}
		<div class="warning-banner">
			<AlertTriangle size={20} />
			<span>
				<strong>{formatCurrency(uncategorizedTotal)}</strong> in income/expenses without tax categories assigned.
				<a href="#uncategorized">Review below</a>
			</span>
		</div>
	{/if}

	{#if openItems > 0 || data.taxData.unmappedDocumentLines > 0}
		<div class="warning-banner">
			<AlertTriangle size={20} />
			<span>
				{#if openItems > 0}
					<strong>{data.taxData.openQuestions}</strong> unanswered question{data.taxData.openQuestions === 1 ? "" : "s"} and
					<strong>{data.taxData.missingDocuments}</strong> missing document{data.taxData.missingDocuments === 1 ? "" : "s"}.
				{/if}
				{#if data.taxData.unmappedDocumentLines > 0}
					<strong>{data.taxData.unmappedDocumentLines}</strong> document line{data.taxData.unmappedDocumentLines === 1 ? "" : "s"} without a tax category.
				{/if}
				<a href="/tax/{data.taxData.year}">Open tax prep</a>
			</span>
		</div>
	{/if}

	{#if data.taxData.retirementIncomeExcluded > 0}
		<div class="info-banner">
			<Info size={20} />
			<span>
				<strong>{formatCurrency(data.taxData.retirementIncomeExcluded)}</strong> of income earned inside
				retirement accounts is excluded from this report because it is not taxable when earned.
			</span>
		</div>
	{/if}

	{#snippet categoryTable(section: Section, categories: Category[], kind: string, title: string, bookTotal: number, reportedTotal: number)}
		<div class="subsection">
			<h3>{title}</h3>
			<table class="tax-table">
				<thead>
					<tr>
						<th>Line</th>
						<th>Category</th>
						{#if section.hasDocuments}
							<th class="amount">Per Books</th>
							<th class="amount">Per Documents</th>
							<th class="amount">Variance</th>
						{:else}
							<th class="amount">Amount</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each categories as category (category.taxCategoryId)}
						{@const key = `${section.key}-${kind}-${category.taxCategoryId}`}
						<tr
							class="category-row"
							class:expandable={isExpandable(category)}
							onclick={() => isExpandable(category) && toggleCategory(key)}
						>
							<td class="line-ref">{category.scheduleRef ?? "—"}</td>
							<td class="category-name">
								{#if isExpandable(category)}
									{#if expandedCategories.has(key)}
										<ChevronDown size={16} />
									{:else}
										<ChevronRight size={16} />
									{/if}
								{/if}
								{category.taxCategoryName}
							</td>
							{#if section.hasDocuments}
								<td class="amount" class:superseded={category.documentTotal !== null}>{formatCurrencyPrecise(category.total)}</td>
								<td class="amount">{category.documentTotal !== null ? formatCurrencyPrecise(category.documentTotal) : "—"}</td>
								<td class="amount variance" class:nonzero={category.documentTotal !== null && Math.abs(category.documentTotal - category.total) >= 0.01}>
									{category.documentTotal !== null ? formatCurrencyPrecise(category.documentTotal - category.total) : "—"}
								</td>
							{:else}
								<td class="amount">{formatCurrencyPrecise(category.total)}</td>
							{/if}
						</tr>
						{#if expandedCategories.has(key)}
							{#each category.accounts as account (account.id)}
								<tr class="account-row">
									<td></td>
									<td class="account-path">{account.path}</td>
									<td class="amount">{formatCurrencyPrecise(account.total)}</td>
									{#if section.hasDocuments}
										<td></td>
										<td></td>
									{/if}
								</tr>
							{/each}
							{#each category.documentLines as line (line.documentId + line.box)}
								<tr class="account-row document-line">
									<td></td>
									<td class="account-path">
										<a href="/tax/{data.taxData.year}#doc-{line.documentId}">{line.formType} · {line.issuer}</a>
										<span class="box-label">box {line.box}, {line.label}</span>
									</td>
									{#if section.hasDocuments}
										<td></td>
										<td class="amount">{formatCurrencyPrecise(line.amount)}</td>
										<td></td>
									{:else}
										<td class="amount">{formatCurrencyPrecise(line.amount)}</td>
									{/if}
								</tr>
							{/each}
						{/if}
					{/each}
					<tr class="total-row">
						<td></td>
						<td><strong>Total {title}</strong></td>
						{#if section.hasDocuments}
							<td class="amount"><strong>{formatCurrencyPrecise(bookTotal)}</strong></td>
							<td class="amount"><strong>{formatCurrencyPrecise(reportedTotal)}</strong></td>
							<td class="amount"><strong>{formatCurrencyPrecise(reportedTotal - bookTotal)}</strong></td>
						{:else}
							<td class="amount"><strong>{formatCurrencyPrecise(bookTotal)}</strong></td>
						{/if}
					</tr>
				</tbody>
			</table>
		</div>
	{/snippet}

	<!-- Dynamic Schedule Sections -->
	{#each data.taxData.sections as section (section.key)}
		<section class="report-section" class:warning-section={section.unassigned}>
			<h2>
				{section.schedule}
				{#if section.businessName}
					<span class="business-tag"><Briefcase size={14} /> {section.businessName}</span>
				{:else if section.unassigned}
					<span class="business-tag unassigned-tag">no business assigned</span>
				{/if}
			</h2>
			{#if section.unassigned}
				<p class="section-description">
					These accounts have {section.schedule} categories but no business, so they aren't on any business's return.
					<a href="/tax/{data.taxData.year}">Assign them in tax prep</a>.
				</p>
			{:else if section.description}
				<p class="section-description">{section.description}</p>
			{/if}

			{#if section.incomeCategories.length > 0}
				{@render categoryTable(section, section.incomeCategories, "inc", "Income", section.totalIncome, section.reportedIncome)}
			{/if}

			{#if section.expenseCategories.length > 0}
				{@render categoryTable(
					section,
					section.expenseCategories,
					"exp",
					section.schedule === "Schedule A" ? "Deductions" : "Expenses",
					section.totalExpenses,
					section.reportedExpenses
				)}
			{/if}

			<!-- Net for this section (if both income and expenses exist) -->
			{#if section.incomeCategories.length > 0 && section.expenseCategories.length > 0}
				<div class="section-net">
					<span>Net {section.schedule === 'Schedule C' ? 'Profit' : 'Amount'}</span>
					<span class="net-amount" class:positive={section.reportedNet >= 0} class:negative={section.reportedNet < 0}>
						{formatCurrencyPrecise(section.reportedNet)}
					</span>
				</div>
			{/if}
		</section>
	{/each}

	<!-- Non-Deductible Section -->
	{#if data.taxData.nonDeductible.expenses.length > 0 || data.taxData.nonDeductible.income.length > 0}
		<section class="report-section muted-section">
			<h2>Non-Deductible Items</h2>
			<p class="section-description">
				Personal expenses and tax-exempt income not included in tax calculations.
			</p>

			{#if data.taxData.nonDeductible.expenses.length > 0}
				<div class="subsection">
					<h3>Personal Expenses</h3>
					<table class="tax-table">
						<thead>
							<tr>
								<th>Category</th>
								<th class="amount">Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each data.taxData.nonDeductible.expenses as category (category.taxCategoryId)}
								<tr
									class="category-row"
									class:expandable={category.accounts.length > 1}
									onclick={() => category.accounts.length > 1 && toggleCategory(`nd-${category.taxCategoryId}`)}
								>
									<td class="category-name">
										{#if category.accounts.length > 1}
											{#if expandedCategories.has(`nd-${category.taxCategoryId}`)}
												<ChevronDown size={16} />
											{:else}
												<ChevronRight size={16} />
											{/if}
										{/if}
										{category.taxCategoryName}
									</td>
									<td class="amount">{formatCurrencyPrecise(category.total)}</td>
								</tr>
								{#if expandedCategories.has(`nd-${category.taxCategoryId}`)}
									{#each category.accounts as account (account.id)}
										<tr class="account-row">
											<td class="account-path">{account.path}</td>
											<td class="amount">{formatCurrencyPrecise(account.total)}</td>
										</tr>
									{/each}
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if data.taxData.nonDeductible.income.length > 0}
				<div class="subsection">
					<h3>Tax-Exempt Income</h3>
					<table class="tax-table">
						<thead>
							<tr>
								<th>Category</th>
								<th class="amount">Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each data.taxData.nonDeductible.income as category (category.taxCategoryId)}
								<tr>
									<td>{category.taxCategoryName}</td>
									<td class="amount">{formatCurrencyPrecise(category.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Uncategorized Section -->
	{#if hasUncategorized}
		<section class="report-section warning-section" id="uncategorized">
			<h2>Needs Tax Category Assignment</h2>
			<p class="section-description">
				These accounts have transactions but no tax category assigned. Assign tax categories to include them in the appropriate schedules.
			</p>

			{#if data.taxData.uncategorizedIncome.length > 0}
				<div class="subsection">
					<h3>Income Accounts</h3>
					<table class="tax-table">
						<thead>
							<tr>
								<th>Account</th>
								<th class="amount">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each data.taxData.uncategorizedIncome as account (account.id)}
								<tr>
									<td><a href="/accounts/{account.id}">{account.path}</a></td>
									<td class="amount">{formatCurrencyPrecise(account.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if data.taxData.uncategorizedExpenses.length > 0}
				<div class="subsection">
					<h3>Expense Accounts</h3>
					<table class="tax-table">
						<thead>
							<tr>
								<th>Account</th>
								<th class="amount">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each data.taxData.uncategorizedExpenses as account (account.id)}
								<tr>
									<td><a href="/accounts/{account.id}">{account.path}</a></td>
									<td class="amount">{formatCurrencyPrecise(account.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Empty state when no data -->
	{#if data.taxData.sections.length === 0 && !hasUncategorized && data.taxData.nonDeductible.expenses.length === 0 && data.taxData.nonDeductible.income.length === 0}
		<section class="report-section">
			<p class="no-data">No tax data recorded for {data.taxData.year}.</p>
		</section>
	{/if}
</div>

<style>
	.tax-report-page {
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

	.year-select {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 16px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.info-banner {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		background: var(--color-info-light);
		border: 1px solid var(--color-info);
		border-radius: var(--radius-md);
		margin-bottom: var(--spacing-lg);
		color: var(--color-text);
	}

	.warning-banner {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		background: var(--color-warning-light);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-md);
		margin-bottom: var(--spacing-lg);
		color: var(--color-text);
	}

	.warning-banner :global(svg) {
		color: var(--color-warning);
		flex-shrink: 0;
	}

	.warning-banner a {
		color: var(--color-primary);
	}

	.report-section {
		margin-bottom: var(--spacing-xl);
		padding: var(--spacing-lg);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.report-section h2 {
		margin: 0 0 var(--spacing-xs);
		font-size: 18px;
	}

	.business-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: var(--spacing-xs);
		padding: 1px 8px;
		font-size: 12px;
		font-weight: 500;
		vertical-align: middle;
		border-radius: var(--radius-sm);
		background: var(--color-primary-light, var(--color-bg-alt));
		color: var(--color-primary);
	}

	.unassigned-tag {
		background: var(--color-warning-light);
		color: var(--color-text);
	}

	.section-description a {
		color: var(--color-primary);
	}

	.section-description {
		margin: 0 0 var(--spacing-md);
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.subsection {
		margin-bottom: var(--spacing-lg);
	}

	.subsection:last-child {
		margin-bottom: 0;
	}

	.subsection h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: 15px;
		color: var(--color-text-muted);
	}

	.tax-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}

	.tax-table th {
		text-align: left;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 2px solid var(--color-border);
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.tax-table td {
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border-light);
	}

	.tax-table .amount {
		text-align: right;
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.tax-table th.amount {
		text-align: right;
	}

	.line-ref {
		color: var(--color-text-muted);
		font-size: 12px;
		white-space: nowrap;
		width: 140px;
	}

	.category-row {
		background: var(--color-bg);
	}

	.category-row.expandable {
		cursor: pointer;
	}

	.category-row.expandable:hover {
		background: var(--color-bg-alt);
	}

	.category-name {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.category-name :global(svg) {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.account-row {
		background: var(--color-bg-alt);
	}

	.account-path {
		padding-left: var(--spacing-xl) !important;
		color: var(--color-text-muted);
	}

	.total-row {
		background: var(--color-bg-alt);
	}

	.superseded {
		color: var(--color-text-light);
		text-decoration: line-through;
	}

	.variance.nonzero {
		color: var(--color-danger);
	}

	.document-line a {
		color: var(--color-primary);
		text-decoration: none;
	}

	.box-label {
		margin-left: var(--spacing-xs);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.section-net {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-md);
		margin-top: var(--spacing-md);
		font-weight: 600;
	}

	.net-amount {
		font-family: var(--font-mono);
	}

	.net-amount.positive {
		color: var(--color-success);
	}

	.net-amount.negative {
		color: var(--color-danger);
	}

	.muted-section {
		opacity: 0.7;
	}

	.muted-section h2 {
		color: var(--color-text-muted);
	}

	.warning-section {
		border-color: var(--color-warning);
		background: var(--color-warning-light);
	}

	.warning-section h2 {
		color: var(--color-warning-dark, var(--color-text));
	}

	.no-data {
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--spacing-lg);
	}

	@media (max-width: 600px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--spacing-sm);
		}

		.line-ref {
			display: none;
		}
	}
</style>
