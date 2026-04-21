<script lang="ts">
	import { CheckSquare, Square, ArrowUp, ArrowDown, ArrowLeftRight } from 'lucide-svelte';
	import TransactionRow from './TransactionRow.svelte';
	import AccountAutocomplete from './AccountAutocomplete.svelte';
	import LazyTable from './LazyTable.svelte';
	import Button from './ui/Button.svelte';

	type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

	interface Account {
		id: string;
		type: AccountType;
		path: string;
	}

	interface TransactionAccount {
		id: string;
		type: string;
		path: string;
	}

	interface Transaction {
		id: string;
		date: string;
		description: string;
		memo?: string | null;
		amount: number;
		status: 'PENDING' | 'CATEGORIZED' | string;
		debitAccount?: TransactionAccount | null;
		creditAccount?: TransactionAccount | null;
		balance?: number;
	}

	type SortColumn = 'date' | 'amount' | 'description';
	type SortOrder = 'asc' | 'desc';

	interface Props {
		transactions: Transaction[];
		accounts?: Account[];
		showBalance?: boolean;
		showSelection?: boolean;
		editable?: boolean;
		sortBy?: SortColumn;
		sortOrder?: SortOrder;
		hasMore?: boolean;
		hasTextFilter?: boolean;
		loadMore?: () => Promise<void>;
		onsort?: (column: SortColumn) => void;
		onaccountchange?: (id: string, side: 'debit' | 'credit', accountId: string) => void;
		onaccountclick?: (accountId: string) => void;
		onapplyall?: (side: 'debit' | 'credit', accountId: string) => void;
		onflip?: (ids: string[]) => void;
	}

	let {
		transactions,
		accounts = [],
		showBalance = false,
		showSelection = false,
		editable = false,
		sortBy,
		sortOrder,
		hasMore = false,
		hasTextFilter = false,
		loadMore,
		onsort,
		onaccountchange,
		onaccountclick,
		onapplyall,
		onflip
	}: Props = $props();

	let selectedIds = $state<Set<string>>(new Set());
	let bulkDebitAccountId = $state('');
	let bulkCreditAccountId = $state('');

	const selectedCount = $derived(selectedIds.size);
	const allSelected = $derived(selectedIds.size === transactions.length && transactions.length > 0);

	const uncategorizedDebitCount = $derived(
		transactions.filter((tx) => !tx.debitAccount).length
	);

	const uncategorizedCreditCount = $derived(
		transactions.filter((tx) => !tx.creditAccount).length
	);

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) {
			selectedIds.delete(id);
		} else {
			selectedIds.add(id);
		}
		selectedIds = new Set(selectedIds);
	}

	function toggleSelectAll() {
		if (allSelected) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(transactions.map((t) => t.id));
		}
	}

	function handleBulkCategorize(side: 'debit' | 'credit', accountId: string) {
		if (!accountId || selectedIds.size === 0) return;

		// Apply to each selected transaction
		selectedIds.forEach((id) => {
			onaccountchange?.(id, side, accountId);
		});

		// Reset state after categorization
		if (side === 'debit') {
			bulkDebitAccountId = '';
		} else {
			bulkCreditAccountId = '';
		}
		selectedIds = new Set();
	}

	function handleApplyAllWithConfirm(side: 'debit' | 'credit', accountId: string) {
		const count = side === 'debit' ? uncategorizedDebitCount : uncategorizedCreditCount;
		const account = accounts.find((a) => a.id === accountId);
		const accountName = account ? account.path : 'this account';

		if (confirm(`Apply "${accountName}" to ${count} uncategorized transaction${count !== 1 ? 's' : ''}?`)) {
			onapplyall?.(side, accountId);
		}
	}

	function handleFlip() {
		onflip?.([...selectedIds]);
		selectedIds = new Set();
	}
</script>

<div class="transactions-table-wrapper">
	<table class="transactions-table">
		<thead>
			<tr>
				{#if showSelection}
					<th class="checkbox-col">
						<button
							class="select-all"
							onclick={toggleSelectAll}
							aria-label={allSelected ? 'Deselect all' : 'Select all'}
						>
							{#if allSelected}
								<CheckSquare size={18} />
							{:else}
								<Square size={18} />
							{/if}
						</button>
					</th>
				{/if}
				<th class:sortable={!!onsort} onclick={() => onsort?.('date')}>
					<span class="sort-header">
						Date
						{#if sortBy === 'date'}
							{#if sortOrder === 'asc'}
								<ArrowUp size={14} />
							{:else}
								<ArrowDown size={14} />
							{/if}
						{/if}
					</span>
				</th>
				<th class:sortable={!!onsort} onclick={() => onsort?.('description')}>
					<span class="sort-header">
						Description
						{#if sortBy === 'description'}
							{#if sortOrder === 'asc'}
								<ArrowUp size={14} />
							{:else}
								<ArrowDown size={14} />
							{/if}
						{/if}
					</span>
				</th>
				<th>Credit (Out)</th>
				<th>Debit (In)</th>
				<th>Status</th>
				<th class="text-right" class:sortable={!!onsort} onclick={() => onsort?.('amount')}>
					<span class="sort-header right">
						Amount
						{#if sortBy === 'amount'}
							{#if sortOrder === 'asc'}
								<ArrowUp size={14} />
							{:else}
								<ArrowDown size={14} />
							{/if}
						{/if}
					</span>
				</th>
				{#if showBalance}
					<th class="text-right">Balance</th>
				{/if}
			</tr>
			{#if showSelection && selectedCount > 0}
				<tr class="bulk-edit-row">
					<td class="checkbox-col"></td>
					<td></td>
					<td class="bulk-label">
						<span class="selected-count">{selectedCount} selected</span>
					</td>
					<td class="account-cell">
						<AccountAutocomplete
							{accounts}
							bind:value={bulkCreditAccountId}
							placeholder="Set credit..."
							onselect={(account) => handleBulkCategorize('credit', account.id)}
						/>
					</td>
					<td class="account-cell">
						<AccountAutocomplete
							{accounts}
							bind:value={bulkDebitAccountId}
							placeholder="Set debit..."
							onselect={(account) => handleBulkCategorize('debit', account.id)}
						/>
					</td>
					<td class="flip-cell">
						<Button variant="secondary" size="sm" onclick={handleFlip}>
							<ArrowLeftRight size={14} />
							Flip
						</Button>
					</td>
					<td></td>
					{#if showBalance}
						<td></td>
					{/if}
				</tr>
			{/if}
		</thead>
		<tbody>
			{#if hasMore && loadMore}
				<LazyTable items={transactions} {hasMore} {loadMore}>
					{#snippet children(tx)}
						<TransactionRow
							transaction={tx}
							{accounts}
							selected={selectedIds.has(tx.id)}
							{editable}
							balance={showBalance ? tx.balance : null}
							showApplyAllDebit={hasTextFilter && uncategorizedDebitCount > 0 && !!tx.debitAccount}
							showApplyAllCredit={hasTextFilter && uncategorizedCreditCount > 0 && !!tx.creditAccount}
							onselect={showSelection ? toggleSelect : undefined}
							onaccountchange={onaccountchange}
							onaccountclick={onaccountclick}
							onapplyall={handleApplyAllWithConfirm}
						/>
					{/snippet}
				</LazyTable>
			{:else}
				{#each transactions as tx (tx.id)}
					<TransactionRow
						transaction={tx}
						{accounts}
						selected={selectedIds.has(tx.id)}
						{editable}
						balance={showBalance ? tx.balance : null}
						showApplyAllDebit={hasTextFilter && uncategorizedDebitCount > 0 && !!tx.debitAccount}
						showApplyAllCredit={hasTextFilter && uncategorizedCreditCount > 0 && !!tx.creditAccount}
						onselect={showSelection ? toggleSelect : undefined}
						onaccountchange={onaccountchange}
						onaccountclick={onaccountclick}
						onapplyall={handleApplyAllWithConfirm}
					/>
				{/each}
			{/if}
		</tbody>
	</table>

	{#if transactions.length === 0}
		<p class="empty-state">No transactions found.</p>
	{/if}
</div>

<style>
	.transactions-table-wrapper {
		overflow-x: auto;
	}

	.transactions-table {
		width: 100%;
		min-width: 900px;
	}

	.checkbox-col {
		width: 40px;
		text-align: center;
	}

	.select-all {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.select-all:hover {
		color: var(--color-primary);
	}

	.sortable {
		cursor: pointer;
		user-select: none;
	}

	.sortable:hover {
		color: var(--color-primary);
	}

	.sort-header {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.sort-header.right {
		justify-content: flex-end;
	}

	.sort-header :global(svg) {
		color: var(--color-primary);
	}

	.bulk-edit-row {
		background: var(--color-primary-light);
	}

	.bulk-edit-row td {
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 2px solid var(--color-primary);
	}

	.bulk-label {
		text-align: right;
		padding-right: var(--spacing-md);
	}

	.selected-count {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.account-cell {
		min-width: 180px;
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: var(--spacing-xl);
	}
</style>
