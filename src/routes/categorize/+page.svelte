<script lang="ts">
	import { CheckCircle, ChevronDown, ChevronRight, Bot } from 'lucide-svelte';
	import AccountTypeBadge from '$lib/components/AccountTypeBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import AccountAutocomplete from '$lib/components/AccountAutocomplete.svelte';
	import { showToast } from '$lib/components/ui/Toast.svelte';
	import { invalidateAll } from '$app/navigation';
	import { sessionStore } from '$lib/stores/sessions';
	import { generateCategorizePrompt } from '$lib/prompts/categorize';

	let { data, form } = $props();

	// Start with first 3 groups expanded - intentionally captures initial value only
	// svelte-ignore state_referenced_locally
	let expandedGroups = $state<Set<string>>(new Set(data.groups.slice(0, 3).map((g) => g.key)));
	let selectedIds = $state<Set<string>>(new Set());
	let categorizeAccountId = $state('');
	let isSubmitting = $state(false);
	let focusedIndex = $state(0);
	let categorizeLoading = $state(false);

	const flatTransactions = $derived(data.groups.flatMap((g) => g.transactions));
	const selectedCount = $derived(selectedIds.size);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function toggleGroup(key: string) {
		if (expandedGroups.has(key)) {
			expandedGroups.delete(key);
		} else {
			expandedGroups.add(key);
		}
		expandedGroups = new Set(expandedGroups);
	}

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) {
			selectedIds.delete(id);
		} else {
			selectedIds.add(id);
		}
		selectedIds = new Set(selectedIds);
	}

	function toggleGroupSelection(group: (typeof data.groups)[0]) {
		const allSelected = group.transactions.every((tx) => selectedIds.has(tx.id));
		if (allSelected) {
			for (const tx of group.transactions) {
				selectedIds.delete(tx.id);
			}
		} else {
			for (const tx of group.transactions) {
				selectedIds.add(tx.id);
			}
		}
		selectedIds = new Set(selectedIds);
	}

	function toggleSubgroupSelection(transactions: (typeof data.groups)[0]['transactions']) {
		const allSelected = transactions.every((tx) => selectedIds.has(tx.id));
		if (allSelected) {
			for (const tx of transactions) {
				selectedIds.delete(tx.id);
			}
		} else {
			for (const tx of transactions) {
				selectedIds.add(tx.id);
			}
		}
		selectedIds = new Set(selectedIds);
	}

	function handleCategorizeSuccess(count: number, accountPath?: string) {
		showToast('success', `Categorized ${count} transaction${count !== 1 ? 's' : ''} → ${accountPath || 'account'}`);
		selectedIds = new Set();
		categorizeAccountId = '';
		isSubmitting = false;
		invalidateAll();
	}

	async function submitCategorization(accountId: string, accountPath: string) {
		if (selectedIds.size === 0 || isSubmitting) return;

		isSubmitting = true;
		const formData = new FormData();
		for (const id of selectedIds) {
			formData.append('ids', id);
		}
		formData.append('accountId', accountId);
		formData.append('isNewAccount', 'false');
		formData.append('newAccountPath', '');

		try {
			const response = await fetch('?/categorize', {
				method: 'POST',
				body: formData,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = await response.json();
			if (result.type === 'success') {
				const updated = result.data?.updated ?? selectedIds.size;
				handleCategorizeSuccess(updated, accountPath);
			} else {
				isSubmitting = false;
			}
		} catch {
			isSubmitting = false;
		}
	}

	function handleAccountSelect(account: { id: string; path: string }) {
		categorizeAccountId = account.id;
		// Auto-submit when account is selected
		submitCategorization(account.id, account.path);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement) return;
		// Don't interfere with Agent panel/terminal
		if ((e.target as HTMLElement).closest?.('.agent-panel')) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusedIndex = Math.min(focusedIndex + 1, flatTransactions.length - 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusedIndex = Math.max(focusedIndex - 1, 0);
				break;
			case ' ':
				e.preventDefault();
				if (flatTransactions[focusedIndex]) {
					toggleSelect(flatTransactions[focusedIndex].id);
				}
				break;
			case 'c':
				if (selectedCount > 0) {
					// Focus the account select
					const accountInput = document.querySelector('.categorize-form input[type="text"]') as HTMLInputElement;
					accountInput?.focus();
				}
				break;
		}
	}

	async function startCategorize() {
		categorizeLoading = true;
		try {
			const res = await fetch('/api/categorize?limit=200');
			if (!res.ok) {
				showToast('error', 'Failed to fetch categorize context');
				return;
			}
			const ctx = await res.json();

			const prompt = generateCategorizePrompt({
				bookId: ctx.bookId,
				accounts: ctx.accounts,
				rules: ctx.rules,
				uncategorizedTransactions: ctx.uncategorizedTransactions,
				totalUncategorized: ctx.totalUncategorized
			});

			sessionStore.connect();
			sessionStore.createSession({
				taskType: 'categorize',
				title: 'Categorize Transactions',
				prompt,
				bookId: ctx.bookId
			});
		} finally {
			categorizeLoading = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="categorize-page">
	<header class="page-header">
		<div class="header-info">
			<h1>Categorize</h1>
			<span class="pending-count">{data.totalPending} pending transaction{data.totalPending !== 1 ? 's' : ''}</span>
		</div>
		{#if data.totalPending > 0}
			<Button variant="secondary" onclick={startCategorize} disabled={categorizeLoading}>
				<Bot size={16} />
				{categorizeLoading ? 'Loading...' : 'Categorize with Agent'}
			</Button>
		{/if}
	</header>

	{#if data.totalPending === 0}
		<div class="empty-state">
			<CheckCircle size={48} strokeWidth={1} />
			<h3>All caught up!</h3>
			<p>No pending transactions to categorize.</p>
		</div>
	{:else}
		<div class="layout">
			<div class="transaction-groups">
				{#each data.groups as group (group.key)}
					<div class="group" class:expanded={expandedGroups.has(group.key)}>
						<button class="group-header" onclick={() => toggleGroup(group.key)}>
							{#if expandedGroups.has(group.key)}
								<ChevronDown size={18} />
							{:else}
								<ChevronRight size={18} />
							{/if}
							<span class="group-pattern">{group.pattern}</span>
							<span class="group-count">{group.transactions.length}</span>
							<Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); toggleGroupSelection(group); }}>
								{group.transactions.every((tx) => selectedIds.has(tx.id)) ? 'Deselect all' : 'Select all'}
							</Button>
						</button>

						{#if expandedGroups.has(group.key)}
							<div class="subgroups">
								{#each group.subgroups as subgroup (subgroup.isRecurring ? subgroup.amount : 'unique')}
									<div class="subgroup" class:recurring={subgroup.isRecurring}>
										{#if group.subgroups.length > 1}
											<div class="subgroup-header">
												{#if subgroup.isRecurring}
													<span class="subgroup-amount">{formatAmount(subgroup.amount)}</span>
													<span class="subgroup-count">× {subgroup.transactions.length}</span>
												{:else}
													<span class="subgroup-label">Other amounts</span>
													<span class="subgroup-count">{subgroup.transactions.length}</span>
												{/if}
												<Button variant="ghost" size="sm" onclick={() => toggleSubgroupSelection(subgroup.transactions)}>
													{subgroup.transactions.every((tx) => selectedIds.has(tx.id)) ? 'Deselect' : 'Select'}
												</Button>
											</div>
										{/if}
										<ul class="transaction-list">
											{#each subgroup.transactions as tx (tx.id)}
												{@const globalIndex = flatTransactions.indexOf(tx)}
												<li class:selected={selectedIds.has(tx.id)} class:focused={globalIndex === focusedIndex}>
													<button class="tx-row" onclick={() => toggleSelect(tx.id)}>
														<input type="checkbox" checked={selectedIds.has(tx.id)} tabindex="-1" />
														<span class="tx-date">{formatDate(tx.date)}</span>
														<span class="tx-desc">{tx.description}</span>
														<span class="tx-account">
															{#if tx.debitAccount}
																<AccountTypeBadge type={tx.debitAccount.type} />
																{tx.debitAccount.path}
															{:else if tx.creditAccount}
																<AccountTypeBadge type={tx.creditAccount.type} />
																{tx.creditAccount.path}
															{:else}
																<span class="no-account">—</span>
															{/if}
														</span>
														<span class="tx-amount" class:expense={tx.creditAccount} class:income={tx.debitAccount}>
															{tx.creditAccount ? '−' : '+'}{formatAmount(tx.amount)}
														</span>
													</button>
												</li>
											{/each}
										</ul>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<aside class="categorize-panel">
				<h2>Categorize Selected</h2>

				{#if selectedCount > 0}
					<p class="selection-info">{selectedCount} transaction{selectedCount !== 1 ? 's' : ''} selected</p>

					<div class="categorize-form">
						<div class="form-group">
							<span class="field-label" id="account-label">Account</span>
							<AccountAutocomplete
								accounts={data.accounts}
								bind:value={categorizeAccountId}
								placeholder="Type to search or create..."
								disabled={isSubmitting}
								onselect={handleAccountSelect}
							/>
						</div>

						{#if isSubmitting}
							<p class="submitting-info">Categorizing...</p>
						{/if}

						{#if form?.error}
							<p class="error">{form.error}</p>
						{/if}
					</div>
				{:else}
					<p class="no-selection">Select transactions to categorize them.</p>
					<div class="shortcuts">
						<h3>Keyboard Shortcuts</h3>
						<ul>
							<li><kbd>j</kbd> / <kbd>↓</kbd> Next</li>
							<li><kbd>k</kbd> / <kbd>↑</kbd> Previous</li>
							<li><kbd>Space</kbd> Toggle selection</li>
							<li><kbd>c</kbd> Focus account input</li>
						</ul>
					</div>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.categorize-page {
		max-width: 1200px;
	}

	.categorize-page:has(.empty-state) {
		max-width: none;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
	}

	.header-info {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-sm);
	}

	.pending-count {
		color: var(--color-text-muted);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-success);
	}

	.empty-state h3 {
		margin: var(--spacing-md) 0 var(--spacing-xs);
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr 300px;
		gap: var(--spacing-lg);
	}

	.transaction-groups {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.group {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-alt);
		border: none;
		text-align: left;
		cursor: pointer;
	}

	.group-header:hover {
		background: var(--color-bg-hover);
	}

	.group-pattern {
		flex: 1;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.group-count {
		padding: 2px 8px;
		background: var(--color-primary-light);
		color: var(--color-primary);
		border-radius: var(--radius-sm);
		font-size: 12px;
		font-weight: 600;
	}

	.subgroups {
		display: flex;
		flex-direction: column;
	}

	.subgroup:not(:first-child) {
		border-top: 2px solid var(--color-border);
	}

	.subgroup-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		padding-left: calc(var(--spacing-md) + 18px + var(--spacing-sm));
		background: var(--color-bg-alt);
		font-size: 13px;
	}

	.subgroup-amount {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--color-text);
	}

	.subgroup-label {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.subgroup-count {
		color: var(--color-text-muted);
	}

	.subgroup.recurring .subgroup-header {
		background: var(--color-primary-light);
	}

	.transaction-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.transaction-list li {
		border-top: 1px solid var(--color-border-light);
	}

	.transaction-list li.selected {
		background: var(--color-primary-light);
	}

	.transaction-list li.focused {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.tx-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
	}

	.tx-row:hover {
		background: var(--color-bg-alt);
	}

	.tx-row input[type='checkbox'] {
		pointer-events: none;
	}

	.tx-date {
		width: 90px;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.tx-desc {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tx-account {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.no-account {
		color: var(--color-text-light);
	}

	.tx-amount {
		width: 90px;
		text-align: right;
		font-family: var(--font-mono);
		font-size: 13px;
	}

	.tx-amount.expense {
		color: var(--color-danger);
	}

	.tx-amount.income {
		color: var(--color-success);
	}

	.categorize-panel {
		position: sticky;
		top: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		height: fit-content;
	}

	.categorize-panel h2 {
		margin: 0 0 var(--spacing-md);
		font-size: 16px;
	}

	.selection-info {
		margin: 0 0 var(--spacing-md);
		font-weight: 500;
	}

	.form-group {
		margin-bottom: var(--spacing-md);
	}

	.field-label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-size: 13px;
		font-weight: 500;
	}

	.error {
		color: var(--color-danger);
		font-size: 13px;
	}

	.submitting-info {
		color: var(--color-primary);
		font-size: 13px;
		margin: 0;
	}

	.no-selection {
		color: var(--color-text-muted);
	}

	.shortcuts {
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-lg);
		border-top: 1px solid var(--color-border-light);
	}

	.shortcuts h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.shortcuts ul {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.shortcuts li {
		padding: var(--spacing-xs) 0;
	}

	.shortcuts kbd {
		display: inline-block;
		padding: 2px 6px;
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
	}
</style>
