<script lang="ts">
	import Dropdown from '$lib/components/ui/Dropdown.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import TaxCategoryAutocomplete from '$lib/components/TaxCategoryAutocomplete.svelte';

	interface TaxCategory {
		id: string;
		name: string;
		scheduleRef: string | null;
	}

	let {
		type = $bindable('EXPENSE'),
		path = $bindable(''),
		taxCategoryId = $bindable(''),
		openingBalance = $bindable(''),
		last4 = $bindable(''),
		assetType = $bindable(''),
		businessId = $bindable(''),
		taxCategories,
		businesses = [],
		error = null,
		submitLabel = 'Save',
		oncancel
	}: {
		type: string;
		path: string;
		taxCategoryId: string;
		openingBalance: string;
		last4: string;
		assetType: string;
		businessId?: string;
		taxCategories: TaxCategory[];
		businesses?: { id: string; name: string }[];
		error?: string | null;
		submitLabel?: string;
		oncancel: () => void;
	} = $props();

	const typeOptions = [
		{ value: 'ASSET', label: 'Asset' },
		{ value: 'LIABILITY', label: 'Liability' },
		{ value: 'EQUITY', label: 'Equity' },
		{ value: 'INCOME', label: 'Income' },
		{ value: 'EXPENSE', label: 'Expense' }
	];

	const assetTypeOptions = [
		{ value: '', label: 'None' },
		{ value: 'LIQUID', label: 'Liquid (Banking)' },
		{ value: 'BROKERAGE', label: 'Brokerage' },
		{ value: 'ROTH_RETIREMENT', label: 'Roth Retirement' },
		{ value: 'TAX_DEFERRED', label: 'Tax Deferred (401k, Traditional IRA)' }
	];

	const showAssetLiabilityFields = $derived(type === 'ASSET' || type === 'LIABILITY');
	const showAssetType = $derived(type === 'ASSET');
	const showBusiness = $derived(businesses.length > 0 && (type === 'INCOME' || type === 'EXPENSE'));
	const businessOptions = $derived([{ value: '', label: 'None' }, ...businesses.map((b) => ({ value: b.id, label: b.name }))]);
</script>

<div class="form-group">
	<label for="type">Type</label>
	<Dropdown options={typeOptions} bind:value={type} />
	<input type="hidden" name="type" value={type} />
</div>

<div class="form-group">
	<label for="path">Account Name</label>
	<input type="text" id="path" name="path" bind:value={path} placeholder="e.g., Business:Hosting or Chase Checking" required />
	<small class="hint">Use ":" to create nested accounts (e.g., "Utilities:Electric")</small>
</div>

<div class="form-group">
	<label for="taxCategory">Tax Category</label>
	<TaxCategoryAutocomplete {taxCategories} bind:value={taxCategoryId} />
	<input type="hidden" name="taxCategoryId" value={taxCategoryId} />
</div>

{#if showBusiness}
	<div class="form-group">
		<label for="business">Business</label>
		<Dropdown options={businessOptions} bind:value={businessId} />
		<input type="hidden" name="businessId" value={businessId} />
		<small class="hint">Which Schedule C this account reports on</small>
	</div>
{/if}

{#if showAssetLiabilityFields}
	<div class="form-group">
		<label for="openingBalance">Opening Balance</label>
		<input type="number" id="openingBalance" name="openingBalance" bind:value={openingBalance} step="0.01" placeholder="0.00" />
		<small class="hint">Starting balance before any imported transactions</small>
	</div>

	<div class="form-group">
		<label for="last4">Last 4 Digits</label>
		<input type="text" id="last4" name="last4" bind:value={last4} maxlength="4" placeholder="1234" />
		<small class="hint">Last 4 digits of account number (optional)</small>
	</div>
{/if}

{#if showAssetType}
	<div class="form-group">
		<label for="assetType">Asset Type</label>
		<Dropdown options={assetTypeOptions} bind:value={assetType} />
		<input type="hidden" name="assetType" value={assetType} />
		<small class="hint">Liquidity classification for net worth breakdown</small>
	</div>
{/if}

{#if error}
	<p class="error">{error}</p>
{/if}

<div class="form-actions">
	<Button variant="secondary" onclick={oncancel}>Cancel</Button>
	<Button variant="primary" type="submit">{submitLabel}</Button>
</div>

<style>
	.form-group {
		margin-bottom: var(--spacing-md);
	}

	.form-group label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-weight: 500;
	}

	.form-group input[type='text'],
	.form-group input[type='number'] {
		width: 100%;
	}

	.hint {
		display: block;
		margin-top: var(--spacing-xs);
		color: var(--color-text-muted);
		font-size: 12px;
	}

	.error {
		color: var(--color-danger);
		margin: var(--spacing-sm) 0;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-lg);
	}
</style>
