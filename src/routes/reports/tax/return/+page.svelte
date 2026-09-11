<script lang="ts">
	import { ChevronRight, ChevronDown, AlertTriangle, Download, Briefcase, FileText, DollarSign, Receipt, Info } from "lucide-svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import { goto } from "$app/navigation";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Computation = Extract<PageData["result"], { available: true }>["computation"];
	type Form = Computation["forms"][number];
	type Line = Form["lines"][number];

	const computation = $derived(data.result.available ? data.result.computation : null);

	let collapsed = $state<Set<string>>(new Set());
	function toggle(key: string) {
		if (collapsed.has(key)) collapsed.delete(key);
		else collapsed.add(key);
		collapsed = new Set(collapsed);
	}

	const formKey = (form: Form, i: number) => `${form.id}-${form.businessId ?? i}`;

	// Unused input lines stay off the page, as they stay blank on the form
	const visibleLines = (form: Form): Line[] =>
		form.lines.filter((l) => l.kind === "text" ? !!l.text : l.amount !== 0 || l.kind === "total" || l.kind === "result");

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
	}

	function formatCurrencyPrecise(value: number): string {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
	}

	function handleYearChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		goto(`/reports/tax/return?year=${select.value}`);
	}
</script>

<div class="return-page">
	<header class="page-header">
		<h1>
			<a href="/reports">Reports</a>
			<ChevronRight size={20} />
			<a href="/reports/tax?year={data.year}">Tax Report</a>
			<ChevronRight size={20} />
			Draft Return
		</h1>
		<div class="header-actions">
			{#if computation && data.canRenderPdf}
				<a class="button" href="/reports/tax/return/pdf?year={data.year}" download="return-{data.year}-draft.pdf">
					<Download size={16} /> Download filled forms
				</a>
			{/if}
			<select class="year-select" value={data.year} onchange={handleYearChange}>
				{#each data.availableYears as year (year)}
					<option value={year}>{year}</option>
				{/each}
			</select>
		</div>
	</header>

	{#if !data.result.available}
		<div class="warning-banner">
			<AlertTriangle size={20} />
			<span>{data.result.reason} Tax tables exist for {data.result.supportedYears.join(", ")}.</span>
		</div>
	{:else if computation}
		<p class="lede">
			A draft {data.year} federal return, {computation.filingStatusLabel.toLowerCase()}, built from the tax report's figures and the
			documents on hand. Every line shows where its number came from. It is an estimate for checking against
			software or a preparer, not a filed return.
			{#if !data.canRenderPdf}The IRS forms for {data.year} are not on file, so there is no PDF for this year.{/if}
		</p>

		<StatsGrid>
			<StatCard label="Adjusted gross income">
				{#snippet icon()}<DollarSign size={24} />{/snippet}
				{formatCurrency(computation.summary.adjustedGrossIncome)}
			</StatCard>
			<StatCard label="Taxable income">
				{#snippet icon()}<FileText size={24} />{/snippet}
				{formatCurrency(computation.summary.taxableIncome)}
			</StatCard>
			<StatCard label="Total tax" variant="negative">
				{#snippet icon()}<Receipt size={24} />{/snippet}
				{formatCurrency(computation.summary.totalTax)}
			</StatCard>
			{#if computation.summary.refund > 0}
				<StatCard label="Refund" variant="positive">
					{#snippet icon()}<DollarSign size={24} />{/snippet}
					{formatCurrency(computation.summary.refund)}
				</StatCard>
			{:else}
				<StatCard label="Amount owed" variant={computation.summary.amountOwed > 0 ? "warning" : "positive"}>
					{#snippet icon()}<DollarSign size={24} />{/snippet}
					{formatCurrency(computation.summary.amountOwed)}
				</StatCard>
			{/if}
		</StatsGrid>

		<div class="summary-line">
			<span>{computation.summary.deductionKind === "itemized" ? "Itemized deductions" : "Standard deduction"} {formatCurrencyPrecise(computation.summary.deduction)}</span>
			{#if computation.summary.qbiDeduction > 0}<span>QBI deduction {formatCurrencyPrecise(computation.summary.qbiDeduction)}</span>{/if}
			<span>Income tax {formatCurrencyPrecise(computation.summary.incomeTax)}</span>
			{#if computation.summary.selfEmploymentTax > 0}<span>Self-employment tax {formatCurrencyPrecise(computation.summary.selfEmploymentTax)}</span>{/if}
			<span>Payments {formatCurrencyPrecise(computation.summary.totalPayments)}</span>
			<span>Effective rate {computation.summary.effectiveRate}% of AGI</span>
		</div>

		{#if computation.warnings.length > 0}
			<section class="report-section notes-section">
				<h2><Info size={18} /> Check before filing</h2>
				<ul class="warnings">
					{#each computation.warnings as warning, i (i)}
						<li>{warning}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#each computation.forms as form, i (formKey(form, i))}
			{@const key = formKey(form, i)}
			{@const open = !collapsed.has(key)}
			<section class="report-section">
				<h2 class="form-heading">
					<button type="button" class="form-toggle" onclick={() => toggle(key)} aria-expanded={open}>
						{#if open}<ChevronDown size={18} />{:else}<ChevronRight size={18} />{/if}
						{form.name}
					</button>
					<span class="form-title">{form.title}</span>
					{#if form.businessName}
						<span class="business-tag"><Briefcase size={14} /> {form.businessName}</span>
					{:else if form.id === "f1040sc"}
						<span class="business-tag unassigned-tag">no business assigned</span>
					{/if}
				</h2>
				{#if open}
					<table class="tax-table">
						<thead>
							<tr>
								<th>Line</th>
								<th>Description</th>
								<th class="amount">Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each visibleLines(form) as line (line.line)}
								<tr class="line-row" class:total-row={line.kind === "total"} class:result-row={line.kind === "result"}>
									<td class="line-ref">{line.line}</td>
									<td class="line-label">
										{line.label}
										{#if line.detail}<span class="line-detail">{line.detail}</span>{/if}
									</td>
									<td class="amount" class:negative-amount={(line.amount ?? 0) < 0}>
										{#if line.kind === "text"}
											<span class="line-text">{line.text}</span>
										{:else if line.amount !== null}
											{formatCurrencyPrecise(line.amount)}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.return-page {
		max-width: 900px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
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

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-primary);
		color: white;
		border-radius: var(--radius-md);
		text-decoration: none;
		font-size: 14px;
	}

	.year-select {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 16px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.lede {
		color: var(--color-text-muted);
		margin: 0 0 var(--spacing-lg);
	}

	.summary-line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm) var(--spacing-lg);
		margin-bottom: var(--spacing-lg);
		color: var(--color-text-muted);
		font-size: 14px;
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

	.report-section {
		margin-bottom: var(--spacing-lg);
		padding: var(--spacing-lg);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.report-section h2 {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
		font-size: 18px;
	}

	.notes-section {
		background: var(--color-info-light);
		border-color: var(--color-info);
	}

	.warnings {
		margin: var(--spacing-sm) 0 0;
		padding-left: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		font-size: 14px;
	}

	.form-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.form-title {
		font-weight: normal;
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.business-tag {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin-left: var(--spacing-xs);
		padding: 2px var(--spacing-sm);
		border-radius: var(--radius-sm);
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		font-size: 13px;
		font-weight: normal;
	}

	.unassigned-tag {
		background: var(--color-warning-light);
		color: var(--color-warning);
	}

	.tax-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: var(--spacing-md);
		font-size: 14px;
	}

	.tax-table th {
		text-align: left;
		padding: var(--spacing-xs) var(--spacing-sm);
		border-bottom: 2px solid var(--color-border);
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.tax-table td {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-bottom: 1px solid var(--color-border-light);
		vertical-align: top;
	}

	.tax-table .amount {
		text-align: right;
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.line-ref {
		width: 60px;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.line-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.line-detail {
		color: var(--color-text-muted);
		font-size: 12px;
	}

	.line-text {
		font-family: inherit;
		color: var(--color-text);
	}

	.total-row td {
		font-weight: 600;
	}

	.result-row td {
		font-weight: 600;
		background: var(--color-bg-alt);
	}

	.negative-amount {
		color: var(--color-danger);
	}
</style>
