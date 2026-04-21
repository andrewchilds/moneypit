<script lang="ts">
	import { CheckSquare, Square, CopyPlus } from 'lucide-svelte';
	import StatusBadge from './StatusBadge.svelte';
	import AccountTypeBadge from './AccountTypeBadge.svelte';
	import AccountAutocomplete from './AccountAutocomplete.svelte';

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
	}

	interface Props {
		transaction: Transaction;
		accounts?: Account[];
		selected?: boolean;
		editable?: boolean;
		showApplyAllDebit?: boolean;
		showApplyAllCredit?: boolean;
		balance?: number | null;
		onselect?: (id: string) => void;
		onaccountchange?: (id: string, side: 'debit' | 'credit', accountId: string) => void;
		onaccountclick?: (accountId: string) => void;
		onapplyall?: (side: 'debit' | 'credit', accountId: string) => void;
	}

	let {
		transaction,
		accounts = [],
		selected = false,
		editable = false,
		showApplyAllDebit = false,
		showApplyAllCredit = false,
		balance = null,
		onselect,
		onaccountchange,
		onaccountclick,
		onapplyall
	}: Props = $props();

	let editingDebit = $state(false);
	let editingCredit = $state(false);

	let debitValue = $derived.by(() => transaction.debitAccount?.id ?? '');
	let creditValue = $derived.by(() => transaction.creditAccount?.id ?? '');

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function handleDebitChange(account: { id: string }) {
		debitValue = account.id;
		editingDebit = false;
		onaccountchange?.(transaction.id, 'debit', account.id);
	}

	function handleCreditChange(account: { id: string }) {
		creditValue = account.id;
		editingCredit = false;
		onaccountchange?.(transaction.id, 'credit', account.id);
	}

	function handleDebitClickOutside() {
		if (transaction.debitAccount) {
			editingDebit = false;
		}
	}

	function handleCreditClickOutside() {
		if (transaction.creditAccount) {
			editingCredit = false;
		}
	}
</script>

<tr class:selected>
	{#if onselect}
		<td class="checkbox-col">
			<button class="select-btn" onclick={() => onselect?.(transaction.id)} aria-label={selected ? 'Deselect' : 'Select'}>
				{#if selected}
					<CheckSquare size={18} />
				{:else}
					<Square size={18} />
				{/if}
			</button>
		</td>
	{/if}
	<td class="date-cell">{formatDate(transaction.date)}</td>
	<td>
		<a href="/transactions/{transaction.id}" class="tx-link">{transaction.description}</a>
		{#if transaction.memo}
			<span class="memo">{transaction.memo}</span>
		{/if}
	</td>
	<td class="account-cell">
		{#if editable && (editingCredit || !transaction.creditAccount)}
			<div class="inline-edit">
				<AccountAutocomplete
					{accounts}
					bind:value={creditValue}
					placeholder="Select credit..."
					autofocus={editingCredit}
					onselect={handleCreditChange}
					onclickoutside={handleCreditClickOutside}
				/>
			</div>
		{:else if transaction.creditAccount}
			<span class="account-display">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="account-info"
					class:clickable={editable}
					onclick={(e) => { if (editable) { e.stopPropagation(); editingCredit = true; } }}
					onkeydown={(e) => e.key === 'Enter' && editable && (editingCredit = true)}
				>
					<AccountTypeBadge type={transaction.creditAccount.type} />
					<button
						type="button"
						class="account-link"
						onclick={(e) => { e.stopPropagation(); onaccountclick?.(transaction.creditAccount!.id); }}
					>{transaction.creditAccount.path}</button>
				</span>
				{#if showApplyAllCredit && onapplyall}
					<button
						type="button"
						class="apply-all-btn"
						title="Apply to all uncategorized"
						onclick={() => onapplyall('credit', transaction.creditAccount!.id)}
					>
						<CopyPlus size={14} />
					</button>
				{/if}
			</span>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="uncategorized"
				class:clickable={editable}
				onclick={() => editable && (editingCredit = true)}
				onkeydown={(e) => e.key === 'Enter' && editable && (editingCredit = true)}
			>
				—
			</span>
		{/if}
	</td>
	<td class="account-cell">
		{#if editable && (editingDebit || !transaction.debitAccount)}
			<div class="inline-edit">
				<AccountAutocomplete
					{accounts}
					bind:value={debitValue}
					placeholder="Select debit..."
					autofocus={editingDebit}
					onselect={handleDebitChange}
					onclickoutside={handleDebitClickOutside}
				/>
			</div>
		{:else if transaction.debitAccount}
			<span class="account-display">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="account-info"
					class:clickable={editable}
					onclick={(e) => { if (editable) { e.stopPropagation(); editingDebit = true; } }}
					onkeydown={(e) => e.key === 'Enter' && editable && (editingDebit = true)}
				>
					<AccountTypeBadge type={transaction.debitAccount.type} />
					<button
						type="button"
						class="account-link"
						onclick={(e) => { e.stopPropagation(); onaccountclick?.(transaction.debitAccount!.id); }}
					>{transaction.debitAccount.path}</button>
				</span>
				{#if showApplyAllDebit && onapplyall}
					<button
						type="button"
						class="apply-all-btn"
						title="Apply to all uncategorized"
						onclick={() => onapplyall('debit', transaction.debitAccount!.id)}
					>
						<CopyPlus size={14} />
					</button>
				{/if}
			</span>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="uncategorized"
				class:clickable={editable}
				onclick={() => editable && (editingDebit = true)}
				onkeydown={(e) => e.key === 'Enter' && editable && (editingDebit = true)}
			>
				—
			</span>
		{/if}
	</td>
	<td>
		<StatusBadge status={transaction.status as 'PENDING' | 'CATEGORIZED'} />
	</td>
	<td class="amount-cell">{formatAmount(transaction.amount)}</td>
	{#if balance !== null}
		<td class="balance-cell">{formatAmount(balance)}</td>
	{/if}
</tr>

<style>
	tr.selected {
		background: var(--color-primary-light);
	}

	tr.selected td {
		background: transparent;
	}

	.checkbox-col {
		width: 40px;
		text-align: center;
	}

	.select-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.select-btn:hover {
		color: var(--color-primary);
	}

	.date-cell {
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.tx-link {
		color: var(--color-text);
		font-weight: 500;
	}

	.tx-link:hover {
		color: var(--color-primary);
	}

	.memo {
		display: block;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.account-cell {
		font-size: 13px;
		min-width: 180px;
	}

	.account-display {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.account-info {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.account-info.clickable {
		cursor: pointer;
		padding: var(--spacing-xs);
		margin: calc(-1 * var(--spacing-xs));
		border-radius: var(--radius-sm);
	}

	.account-info.clickable:hover {
		background: var(--color-bg-alt);
	}

	.account-link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--color-text);
		cursor: pointer;
	}

	.account-link:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}

	.uncategorized.clickable {
		cursor: pointer;
		padding: var(--spacing-xs);
		margin: calc(-1 * var(--spacing-xs));
		border-radius: var(--radius-sm);
	}

	.uncategorized.clickable:hover {
		background: var(--color-bg-alt);
	}

	.uncategorized {
		color: var(--color-text-light);
	}

	.inline-edit {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 200px;
	}

	.apply-all-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: var(--spacing-xs);
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.apply-all-btn:hover {
		background: var(--color-primary-light);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.amount-cell {
		font-family: var(--font-mono);
		text-align: right;
	}

	.balance-cell {
		font-family: var(--font-mono);
		text-align: right;
		color: var(--color-text-muted);
	}
</style>
