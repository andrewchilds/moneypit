<script lang="ts">
	import { ArrowLeft, Pencil, Trash2, Plus, X, AlertTriangle, Check, Search, Play } from 'lucide-svelte';
	import AccountTypeBadge from '$lib/components/AccountTypeBadge.svelte';
	import AccountForm from '$lib/components/AccountForm.svelte';
	import TransactionsTable from '$lib/components/TransactionsTable.svelte';
	import MonthlyActivityChart from '$lib/components/MonthlyActivityChart.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { showToast } from '$lib/components/ui/Toast.svelte';
	import { sessionStore } from '$lib/stores/sessions';
	import { generateAuditPrompt } from '$lib/prompts/audit';

	const assetTypeLabels: Record<string, string> = {
		LIQUID: 'Liquid',
		BROKERAGE: 'Brokerage',
		ROTH_RETIREMENT: 'Roth',
		TAX_DEFERRED: 'Tax Deferred'
	};

	import { enhance } from '$app/forms';
	import { invalidateAll, goto, afterNavigate } from '$app/navigation';

	let { data, form } = $props();

	afterNavigate(() => {
		document.querySelector('.main-content')?.scrollTo(0, 0);
	});

	let showEditModal = $state(false);
	let showDeleteModal = $state(false);
	let showBalanceModal = $state(false);
	let showRuleModal = $state(false);
	let editType = $state('');
	let editPath = $state('');
	let editTaxCategory = $state('');
	let editOpeningBalance = $state('');
	let editLast4 = $state('');
	let editAssetType = $state('');
	let newBalanceDate = $state('');
	let newBalanceAmount = $state('');

	// Rule editing state
	let editingRuleId = $state<string | null>(null);
	let rulePattern = $state('');
	let ruleField = $state('description');
	let ruleIsRegex = $state(false);
	let rulePriority = $state(0);
	let ruleAmountMin = $state('');
	let ruleAmountMax = $state('');
	let ruleAmountExact = $state('');

	// Transaction pagination state
	// svelte-ignore state_referenced_locally
	let transactions = $state(data.transactions);
	// svelte-ignore state_referenced_locally
	let nextCursor = $state(data.nextCursor);
	// svelte-ignore state_referenced_locally
	let totalCount = $state(data.transactions.length);

	// Reset when navigating to a different account
	$effect(() => {
		transactions = data.transactions;
		nextCursor = data.nextCursor;
		totalCount = data.transactions.length;
	});

	async function loadMoreTransactions() {
		if (!nextCursor) return;

		const params = new URLSearchParams({
			accountId: data.account.id,
			cursor: nextCursor,
			limit: '50'
		});

		// Include date filters if set
		if (data.dateFilter.from) {
			params.set('from', data.dateFilter.from);
		}
		if (data.dateFilter.to) {
			params.set('to', data.dateFilter.to);
		}

		const res = await fetch(`/api/transactions?${params}`);
		const result = await res.json();

		transactions = [...transactions, ...result.transactions];
		nextCursor = result.nextCursor;
		totalCount = transactions.length;
	}

	function handleRangeChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const value = select.value;
		if (value === 'all') {
			goto(`/accounts/${data.account.id}`);
		} else if (value.startsWith('year:')) {
			const year = value.replace('year:', '');
			goto(`/accounts/${data.account.id}?range=custom&year=${year}`);
		} else {
			goto(`/accounts/${data.account.id}?range=${value}`);
		}
	}

	// Generate year options (current year - 1, going back 3 years)
	const currentYear = new Date().getFullYear();
	const yearOptions = [currentYear - 1, currentYear - 2, currentYear - 3];

	// Label for the balance based on account type and whether filtering
	const isFiltered = $derived(data.currentRange !== 'all');
	const balanceLabel = $derived.by(() => {
		switch (data.account.type) {
			case 'EXPENSE':
				return 'Total Spent';
			case 'INCOME':
				return 'Total Earned';
			case 'ASSET':
			case 'LIABILITY':
				return isFiltered ? 'Net Change' : 'Current Balance';
			default:
				return 'Total';
		}
	});

	// Sync edit state when data changes or modal opens
	$effect(() => {
		if (showEditModal) {
			editType = data.account.type;
			editPath = data.account.path;
			editTaxCategory = data.account.taxCategoryId ?? '';
			editOpeningBalance = data.account.openingBalance != null ? String(data.account.openingBalance) : '';
			editLast4 = data.account.last4 ?? '';
			editAssetType = data.account.assetType ?? '';
		}
	});

	const canRecordBalance = $derived(
		data.account.type === 'ASSET' || data.account.type === 'LIABILITY'
	);

	function handleEditSuccess() {
		showEditModal = false;
		invalidateAll();
	}

	function handleBalanceSuccess() {
		showBalanceModal = false;
		newBalanceDate = '';
		newBalanceAmount = '';
		invalidateAll();
	}

	function openRuleModal(rule?: typeof data.rules[0]) {
		if (rule) {
			editingRuleId = rule.id;
			rulePattern = rule.pattern;
			ruleField = rule.field;
			ruleIsRegex = rule.isRegex;
			rulePriority = rule.priority;
			ruleAmountMin = rule.amountMin != null ? String(rule.amountMin) : '';
			ruleAmountMax = rule.amountMax != null ? String(rule.amountMax) : '';
			ruleAmountExact = rule.amountExact != null ? String(rule.amountExact) : '';
		} else {
			editingRuleId = null;
			rulePattern = '';
			ruleField = 'description';
			ruleIsRegex = false;
			rulePriority = 0;
			ruleAmountMin = '';
			ruleAmountMax = '';
			ruleAmountExact = '';
		}
		showRuleModal = true;
	}

	function handleRuleSuccess() {
		showRuleModal = false;
		invalidateAll();
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	async function handleAccountChange(txId: string, side: 'debit' | 'credit', accountId: string) {
		const formData = new FormData();
		formData.append('ids', txId);
		formData.append('accountId', accountId);
		formData.append('side', side);

		await fetch('?/categorize', {
			method: 'POST',
			body: formData
		});
		invalidateAll();
	}

	function handleAccountClick(accountId: string) {
		goto(`/accounts/${accountId}`);
	}

	let auditLoading = $state(false);
	let runningRules = $state(false);

	async function runRules() {
		runningRules = true;
		try {
			const res = await fetch('/api/rules/apply', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId: data.account.id })
			});
			const result = await res.json();

			if (result.transactionsUpdated > 0) {
				showToast('success', `Applied ${result.rulesApplied} rule${result.rulesApplied !== 1 ? 's' : ''} to ${result.transactionsUpdated} transaction${result.transactionsUpdated !== 1 ? 's' : ''}`);
				invalidateAll();
			} else {
				showToast('info', 'No pending transactions matched any rules');
			}
		} catch {
			showToast('error', 'Failed to run rules');
		} finally {
			runningRules = false;
		}
	}

	async function startAudit() {
		auditLoading = true;
		try {
			// Fetch full audit context from API
			const res = await fetch(`/api/audit?accountId=${data.account.id}`);
			if (!res.ok) {
				console.error('Failed to fetch audit context');
				return;
			}
			const ctx = await res.json();

			const prompt = generateAuditPrompt({
				bookId: ctx.bookId,
				accountId: ctx.account.id,
				accountType: ctx.account.type,
				accountPath: ctx.account.path,
				transactionCount: ctx.transactionCount,
				rules: ctx.rules,
				transactionSummary: ctx.transactionSummary,
				uncategorizedTransactions: ctx.uncategorizedTransactions
			});

			sessionStore.connect();
			sessionStore.createSession({
				taskType: 'audit',
				title: `Audit: ${ctx.account.path}`,
				prompt,
				accountId: ctx.account.id,
				bookId: ctx.bookId
			});
		} finally {
			auditLoading = false;
		}
	}
</script>

<div class="account-detail">
	<header class="page-header">
		<div class="header-left">
			<a href="/accounts" class="back-link">
				<ArrowLeft size={18} />
			</a>
			<div class="header-info">
				<div class="title-row">
					<h1>{data.account.path}</h1>
					{#if data.account.last4}
						<span class="last4">{data.account.last4}</span>
					{/if}
					<AccountTypeBadge type={data.account.type} size="md" />
					{#if data.account.assetType}
						<Badge text={assetTypeLabels[data.account.assetType]} size="md" />
					{/if}
				</div>
				{#if data.account.taxCategoryId}
					{@const taxCat = data.taxCategories.find((tc) => tc.id === data.account.taxCategoryId)}
					{#if taxCat}
						<span class="tax-category">Tax: {taxCat.name}</span>
					{/if}
				{/if}
			</div>
		</div>
		<div class="header-actions">
			{#if data.rules.length > 0}
				<Button variant="secondary" onclick={runRules} disabled={runningRules}>
					<Play size={16} />
					{runningRules ? 'Running...' : 'Run Rules'}
				</Button>
			{/if}
			<Button variant="secondary" onclick={startAudit} disabled={auditLoading}>
				<Search size={16} />
				{auditLoading ? 'Loading...' : 'Audit'}
			</Button>
			<Button variant="secondary" onclick={() => (showEditModal = true)}>
				<Pencil size={16} />
				Edit
			</Button>
			<Button variant="danger" onclick={() => (showDeleteModal = true)}>
				<Trash2 size={16} />
				Delete
			</Button>
		</div>
	</header>

	<div class="summary-section">
		<div class="chart-card">
			<div class="chart-header">
				<div class="balance-display">
					<span class="balance-value" class:negative={data.currentBalance < 0}>
						{formatCurrency(data.currentBalance)}
					</span>
					<span class="balance-label">{balanceLabel}</span>
				</div>
				<select class="range-select" value={data.currentRange === 'custom' ? `year:${data.currentYear}` : data.currentRange} onchange={handleRangeChange}>
					<option value="last-18-months">Last 18 Months</option>
					<option value="last-12-months">Last 12 Months</option>
					<option value="last-6-months">Last 6 Months</option>
					<option value="ytd">{currentYear} YTD</option>
					{#each yearOptions as year (year)}
						<option value="year:{year}">{year}</option>
					{/each}
					<option value="all">All Time</option>
				</select>
			</div>
			{#if data.monthlyActivity.length > 1}
				<MonthlyActivityChart data={data.monthlyActivity} />
			{:else}
				<p class="empty-chart">Not enough data for chart</p>
			{/if}
		</div>
	</div>

	{#if canRecordBalance}
		<section class="balance-section">
			<div class="section-header">
				<h2>Balance Records</h2>
				<Button variant="secondary" size="sm" onclick={() => (showBalanceModal = true)}>
					<Plus size={14} />
					Record Balance
				</Button>
			</div>

			{#if data.balanceRecords.length > 0}
				<table class="balance-table">
					<thead>
						<tr>
							<th>Date</th>
							<th class="text-right">Statement</th>
							<th class="text-right">Calculated</th>
							<th class="text-right">Difference</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.balanceRecords as record (record.id)}
							{@const diff = record.balance - record.calculatedBalance}
							<tr>
								<td>{formatDate(record.date)}</td>
								<td class="text-right mono">{formatCurrency(record.balance)}</td>
								<td class="text-right mono">{formatCurrency(record.calculatedBalance)}</td>
								<td class="text-right mono" class:match={Math.abs(diff) < 0.01} class:mismatch={Math.abs(diff) >= 0.01}>
									{#if Math.abs(diff) < 0.01}
										<Check size={14} />
									{:else}
										<AlertTriangle size={14} />
										{formatCurrency(diff)}
									{/if}
								</td>
								<td>
									<form method="POST" action="?/deleteBalanceRecord" use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'success') invalidateAll();
										};
									}}>
										<input type="hidden" name="id" value={record.id} />
										<button type="submit" class="delete-btn" aria-label="Delete">
											<X size={14} />
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="empty-state">No balance records yet. Record a statement balance to track reconciliation.</p>
			{/if}
		</section>
	{/if}

	<section class="rules-section">
		<div class="section-header">
			<h2>Rules ({data.rules.length})</h2>
			<Button variant="secondary" size="sm" onclick={() => openRuleModal()}>
				<Plus size={14} />
				Add Rule
			</Button>
		</div>

		{#if data.rules.length > 0}
			<table class="rules-table">
				<thead>
					<tr>
						<th>Pattern</th>
						<th>Field</th>
						<th>Amount</th>
						<th class="text-right">Priority</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.rules as rule (rule.id)}
						<tr>
							<td>
								<div class="pattern-cell">
									{#if rule.isRegex}
										<Badge text="regex" size="sm" />
									{/if}
									<code>{rule.pattern}</code>
								</div>
							</td>
							<td>{rule.field}</td>
							<td class="mono">
								{#if rule.amountExact != null}
									= {formatCurrency(rule.amountExact)}
								{:else if rule.amountMin != null && rule.amountMax != null}
									{formatCurrency(rule.amountMin)} - {formatCurrency(rule.amountMax)}
								{:else if rule.amountMin != null}
									≥ {formatCurrency(rule.amountMin)}
								{:else if rule.amountMax != null}
									≤ {formatCurrency(rule.amountMax)}
								{:else}
									—
								{/if}
							</td>
							<td class="text-right">{rule.priority}</td>
							<td>
								<div class="actions-cell">
									<button class="edit-btn" onclick={() => openRuleModal(rule)} aria-label="Edit">
										<Pencil size={14} />
									</button>
									<form method="POST" action="?/deleteRule" use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'success') invalidateAll();
										};
									}}>
										<input type="hidden" name="id" value={rule.id} />
										<button type="submit" class="delete-btn" aria-label="Delete">
											<X size={14} />
										</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="empty-state">No rules yet. Add a rule to auto-categorize transactions to this account.</p>
		{/if}
	</section>

	<section class="transactions-section">
		<h2>Transactions ({totalCount}{nextCursor ? '+' : ''})</h2>

		{#if transactions.length > 0}
			<TransactionsTable
				{transactions}
				accounts={data.accounts}
				showBalance={true}
				editable={true}
				hasMore={!!nextCursor}
				loadMore={loadMoreTransactions}
				onaccountchange={handleAccountChange}
				onaccountclick={handleAccountClick}
			/>
		{:else}
			<p class="empty-state">No transactions for this account.</p>
		{/if}
	</section>
</div>

<Modal bind:open={showEditModal} title="Edit Account" onclose={() => (showEditModal = false)}>
	<form
		method="POST"
		action="?/update"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'success') {
					handleEditSuccess();
				}
			};
		}}
	>
		<AccountForm
			bind:type={editType}
			bind:path={editPath}
			bind:taxCategoryId={editTaxCategory}
			bind:openingBalance={editOpeningBalance}
			bind:last4={editLast4}
			bind:assetType={editAssetType}
			taxCategories={data.taxCategories}
			error={form?.error}
			submitLabel="Save"
			oncancel={() => (showEditModal = false)}
		/>
	</form>
</Modal>

<Modal bind:open={showDeleteModal} title="Delete Account" onclose={() => (showDeleteModal = false)}>
	<p>Are you sure you want to delete <strong>{data.account.path}</strong>?</p>
	<p class="warning-text">This cannot be undone. The account must have no transactions to be deleted.</p>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" action="?/delete" class="form-actions">
		<Button variant="secondary" onclick={() => (showDeleteModal = false)}>Cancel</Button>
		<Button variant="danger" type="submit">Delete</Button>
	</form>
</Modal>

<Modal bind:open={showBalanceModal} title="Record Balance" onclose={() => (showBalanceModal = false)}>
	<p>Record a statement balance to compare against calculated transactions.</p>

	<form
		method="POST"
		action="?/addBalanceRecord"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'success') {
					handleBalanceSuccess();
				}
			};
		}}
	>
		<div class="form-group">
			<label for="balanceDate">Date</label>
			<input type="date" id="balanceDate" name="date" bind:value={newBalanceDate} required />
		</div>

		<div class="form-group">
			<label for="balanceAmount">Balance</label>
			<input type="number" id="balanceAmount" name="balance" bind:value={newBalanceAmount} step="0.01" required />
		</div>

		{#if form?.error}
			<p class="error">{form.error}</p>
		{/if}

		<div class="form-actions">
			<Button variant="secondary" onclick={() => (showBalanceModal = false)}>Cancel</Button>
			<Button variant="primary" type="submit">Save</Button>
		</div>
	</form>
</Modal>

<Modal bind:open={showRuleModal} title={editingRuleId ? 'Edit Rule' : 'Add Rule'} onclose={() => (showRuleModal = false)}>
	<p>Rules auto-categorize transactions matching the pattern to this account.</p>

	<form
		method="POST"
		action={editingRuleId ? '?/updateRule' : '?/createRule'}
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'success') {
					handleRuleSuccess();
				}
			};
		}}
	>
		{#if editingRuleId}
			<input type="hidden" name="id" value={editingRuleId} />
		{/if}

		<div class="form-group">
			<label for="rulePattern">Pattern</label>
			<input type="text" id="rulePattern" name="pattern" bind:value={rulePattern} placeholder="e.g. AMAZON or ^AMZ.*MKTPLACE" required />
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="ruleField">Match Field</label>
				<select id="ruleField" name="field" bind:value={ruleField}>
					<option value="description">Description</option>
					<option value="memo">Memo</option>
				</select>
			</div>

			<div class="form-group">
				<label for="rulePriority">Priority</label>
				<input type="number" id="rulePriority" name="priority" bind:value={rulePriority} />
			</div>
		</div>

		<div class="form-group checkbox-group">
			<label>
				<input type="checkbox" bind:checked={ruleIsRegex} />
				Use regex
			</label>
			<input type="hidden" name="isRegex" value={ruleIsRegex} />
		</div>

		<div class="form-group">
			<span class="field-label">Amount Filter (optional)</span>
			<div class="amount-filters">
				<div class="amount-filter">
					<label for="ruleAmountExact">Exact</label>
					<input type="number" id="ruleAmountExact" name="amountExact" bind:value={ruleAmountExact} step="0.01" placeholder="0.00" />
				</div>
				<span class="or-text">or</span>
				<div class="amount-filter">
					<label for="ruleAmountMin">Min</label>
					<input type="number" id="ruleAmountMin" name="amountMin" bind:value={ruleAmountMin} step="0.01" placeholder="0.00" />
				</div>
				<div class="amount-filter">
					<label for="ruleAmountMax">Max</label>
					<input type="number" id="ruleAmountMax" name="amountMax" bind:value={ruleAmountMax} step="0.01" placeholder="0.00" />
				</div>
			</div>
		</div>

		{#if form?.error}
			<p class="error">{form.error}</p>
		{/if}

		<div class="form-actions">
			<Button variant="secondary" onclick={() => (showRuleModal = false)}>Cancel</Button>
			<Button variant="primary" type="submit">{editingRuleId ? 'Save' : 'Create'}</Button>
		</div>
	</form>
</Modal>

<style>
	.account-detail {
		width: 100%;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--spacing-lg);
	}

	.header-left {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-md);
	}

	.back-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}

	.back-link:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
		text-decoration: none;
	}

	.header-info {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.title-row h1 {
		margin: 0;
		font-size: 24px;
	}

	.last4 {
		font-size: 14px;
		color: var(--color-text-muted);
	}

	.tax-category {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.header-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.summary-section {
		margin-bottom: var(--spacing-xl);
	}

	.chart-card {
		padding: var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-sm);
	}

	.balance-display {
		display: flex;
		flex-direction: column;
	}

	.range-select {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.balance-value {
		font-size: 24px;
		font-weight: 700;
		line-height: 1.2;
		font-family: var(--font-mono);
	}

	.balance-value.negative {
		color: var(--color-danger);
	}

	.balance-label {
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.empty-chart {
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--spacing-lg);
		margin: 0;
	}

	.balance-section,
	.rules-section,
	.transactions-section {
		margin-bottom: var(--spacing-xl);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-md);
	}

	.section-header h2,
	.transactions-section h2 {
		margin: 0;
		font-size: 16px;
	}

	.balance-table {
		width: 100%;
	}

	.balance-table .mono {
		font-family: var(--font-mono);
	}

	.balance-table .match {
		color: var(--color-success);
	}

	.balance-table .mismatch {
		color: var(--color-danger);
	}

	.delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.delete-btn:hover {
		background: var(--color-danger-light);
		color: var(--color-danger);
	}

	.rules-table {
		width: 100%;
	}

	.rules-table code {
		font-family: var(--font-mono);
		font-size: 13px;
		background: var(--color-bg-alt);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.pattern-cell {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.actions-cell {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		justify-content: flex-end;
	}

	.edit-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.edit-btn:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.form-row {
		display: flex;
		gap: var(--spacing-md);
	}

	.form-row .form-group {
		flex: 1;
	}

	.checkbox-group label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
	}

	.checkbox-group input[type='checkbox'] {
		width: auto;
	}

	.amount-filters {
		display: flex;
		align-items: flex-end;
		gap: var(--spacing-sm);
	}

	.amount-filter {
		flex: 1;
	}

	.amount-filter label {
		display: block;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: var(--spacing-xs);
	}

	.or-text {
		color: var(--color-text-muted);
		font-size: 13px;
		padding-bottom: 8px;
	}

	.field-label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-weight: 500;
	}

	.empty-state {
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--spacing-xl);
	}

	.form-group {
		margin-bottom: var(--spacing-md);
	}

	.form-group label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-weight: 500;
	}

	.form-group input[type='number'] {
		width: 100%;
	}

	.error {
		color: var(--color-danger);
		margin: var(--spacing-sm) 0;
	}

	.warning-text {
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-lg);
	}
</style>
