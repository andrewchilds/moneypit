<script lang="ts">
	import { ArrowLeft, Pencil, Trash2, Save, X } from 'lucide-svelte';
	import AccountTypeBadge from '$lib/components/AccountTypeBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Dropdown from '$lib/components/ui/Dropdown.svelte';
	import AccountAutocomplete from '$lib/components/AccountAutocomplete.svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let editing = $state(false);
	let showDeleteModal = $state(false);

	// Edit form state
	let editDate = $state('');
	let editDescription = $state('');
	let editMemo = $state('');
	let editAmount = $state(0);
	let editDebitAccountId = $state('');
	let editCreditAccountId = $state('');
	let editStatus = $state('PENDING');

	// Sync edit state when entering edit mode
	$effect(() => {
		if (editing) {
			editDate = data.transaction.date;
			editDescription = data.transaction.description;
			editMemo = data.transaction.memo ?? '';
			editAmount = data.transaction.amount;
			editDebitAccountId = data.transaction.debitAccountId ?? '';
			editCreditAccountId = data.transaction.creditAccountId ?? '';
			editStatus = data.transaction.status;
		}
	});

	const statusOptions = [
		{ value: 'PENDING', label: 'Pending' },
		{ value: 'CATEGORIZED', label: 'Categorized' }
	];

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function startEdit() {
		editDate = data.transaction.date;
		editDescription = data.transaction.description;
		editMemo = data.transaction.memo ?? '';
		editAmount = data.transaction.amount;
		editDebitAccountId = data.transaction.debitAccountId ?? '';
		editCreditAccountId = data.transaction.creditAccountId ?? '';
		editStatus = data.transaction.status;
		editing = true;
	}

	function cancelEdit() {
		editing = false;
	}

	function handleSaveSuccess() {
		editing = false;
		invalidateAll();
	}
</script>

<div class="transaction-detail">
	<header class="page-header">
		<div class="header-left">
			<a href="/transactions" class="back-link">
				<ArrowLeft size={18} />
			</a>
			<div class="header-info">
				<h1>{data.transaction.description}</h1>
				<div class="meta">
					<StatusBadge status={data.transaction.status} />
					<span class="amount">{formatAmount(data.transaction.amount)}</span>
				</div>
			</div>
		</div>
		<div class="header-actions">
			{#if !editing}
				<Button variant="secondary" onclick={startEdit}>
					<Pencil size={16} />
					Edit
				</Button>
				<Button variant="danger" onclick={() => (showDeleteModal = true)}>
					<Trash2 size={16} />
					Delete
				</Button>
			{/if}
		</div>
	</header>

	{#if editing}
		<form
			method="POST"
			action="?/update"
			class="edit-form"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success') {
						handleSaveSuccess();
					}
				};
			}}
		>
			<div class="form-grid">
				<div class="form-group">
					<label for="date">Date</label>
					<input type="date" id="date" name="date" bind:value={editDate} required />
				</div>

				<div class="form-group">
					<label for="amount">Amount</label>
					<input type="number" id="amount" name="amount" bind:value={editAmount} step="0.01" min="0" required />
				</div>

				<div class="form-group full-width">
					<label for="description">Description</label>
					<input type="text" id="description" name="description" bind:value={editDescription} required />
				</div>

				<div class="form-group full-width">
					<label for="memo">Memo</label>
					<input type="text" id="memo" name="memo" bind:value={editMemo} />
				</div>

				<div class="form-group">
					<span class="field-label">Credit (Out)</span>
					<AccountAutocomplete
						accounts={data.accounts}
						bind:value={editCreditAccountId}
						placeholder="Select account..."
						onselect={(account) => (editCreditAccountId = account.id)}
					/>
					<input type="hidden" name="creditAccountId" value={editCreditAccountId} />
				</div>

				<div class="form-group">
					<span class="field-label">Debit (In)</span>
					<AccountAutocomplete
						accounts={data.accounts}
						bind:value={editDebitAccountId}
						placeholder="Select account..."
						onselect={(account) => (editDebitAccountId = account.id)}
					/>
					<input type="hidden" name="debitAccountId" value={editDebitAccountId} />
				</div>

				<div class="form-group">
					<span class="field-label">Status</span>
					<Dropdown options={statusOptions} bind:value={editStatus} />
					<input type="hidden" name="status" value={editStatus} />
				</div>
			</div>

			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}

			<div class="form-actions">
				<Button variant="secondary" onclick={cancelEdit}>
					<X size={16} />
					Cancel
				</Button>
				<Button variant="primary" type="submit">
					<Save size={16} />
					Save
				</Button>
			</div>
		</form>
	{:else}
		<div class="detail-grid">
			<div class="detail-row">
				<span class="label">Date</span>
				<span class="value">{new Date(data.transaction.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
			</div>

			<div class="detail-row">
				<span class="label">Amount</span>
				<span class="value amount">{formatAmount(data.transaction.amount)}</span>
			</div>

			<div class="detail-row">
				<span class="label">Description</span>
				<span class="value">{data.transaction.description}</span>
			</div>

			{#if data.transaction.memo}
				<div class="detail-row">
					<span class="label">Memo</span>
					<span class="value">{data.transaction.memo}</span>
				</div>
			{/if}

			<div class="detail-row">
				<span class="label">Credit (Out)</span>
				<span class="value">
					{#if data.transaction.creditAccount}
						<a href="/accounts/{data.transaction.creditAccount.id}" class="account-link">
							<AccountTypeBadge type={data.transaction.creditAccount.type} />
							{data.transaction.creditAccount.path}
						</a>
					{:else}
						<span class="uncategorized">Not set</span>
					{/if}
				</span>
			</div>

			<div class="detail-row">
				<span class="label">Debit (In)</span>
				<span class="value">
					{#if data.transaction.debitAccount}
						<a href="/accounts/{data.transaction.debitAccount.id}" class="account-link">
							<AccountTypeBadge type={data.transaction.debitAccount.type} />
							{data.transaction.debitAccount.path}
						</a>
					{:else}
						<span class="uncategorized">Not set</span>
					{/if}
				</span>
			</div>

			<div class="detail-row">
				<span class="label">Status</span>
				<span class="value">
					<StatusBadge status={data.transaction.status} />
				</span>
			</div>

			{#if data.transaction.importSource}
				<div class="detail-row">
					<span class="label">Import Source</span>
					<span class="value mono">{data.transaction.importSource}</span>
				</div>
			{/if}
		</div>
	{/if}
</div>

<Modal bind:open={showDeleteModal} title="Delete Transaction" onclose={() => (showDeleteModal = false)}>
	<p>Are you sure you want to delete this transaction?</p>
	<p class="warning-text">This cannot be undone.</p>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" action="?/delete" class="form-actions">
		<Button variant="secondary" onclick={() => (showDeleteModal = false)}>Cancel</Button>
		<Button variant="danger" type="submit">Delete</Button>
	</form>
</Modal>

<style>
	.transaction-detail {
		max-width: 800px;
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

	.header-info h1 {
		margin: 0 0 var(--spacing-xs);
		font-size: 24px;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.meta .amount {
		font-family: var(--font-mono);
		font-size: 18px;
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.detail-grid {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.detail-row {
		display: flex;
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border-light);
	}

	.detail-row:last-child {
		border-bottom: none;
	}

	.label {
		width: 180px;
		flex-shrink: 0;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.value {
		flex: 1;
	}

	.value.amount {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.account-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text);
	}

	.account-link:hover {
		color: var(--color-primary);
		text-decoration: none;
	}

	.uncategorized {
		color: var(--color-text-light);
		font-style: italic;
	}

	.edit-form {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.full-width {
		grid-column: span 2;
	}

	.form-group label,
	.field-label {
		font-weight: 500;
		font-size: 13px;
	}

	.form-group input[type='text'],
	.form-group input[type='date'],
	.form-group input[type='number'] {
		width: 100%;
	}

	.error {
		color: var(--color-danger);
		margin: var(--spacing-md) 0;
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
