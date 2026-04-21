<script lang="ts">
	import Badge from './ui/Badge.svelte';

	type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

	interface Props {
		type: AccountType | string;
		size?: 'sm' | 'md';
	}

	let { type, size = 'sm' }: Props = $props();

	const variantMap = {
		ASSET: 'asset',
		LIABILITY: 'liability',
		EQUITY: 'equity',
		INCOME: 'income',
		EXPENSE: 'expense'
	} as const;

	const labelMap = {
		ASSET: 'Asset',
		LIABILITY: 'Liability',
		EQUITY: 'Equity',
		INCOME: 'Income',
		EXPENSE: 'Expense'
	};
</script>

<Badge variant={variantMap[type as AccountType] ?? 'default'} {size} text={labelMap[type as AccountType] ?? type} />
