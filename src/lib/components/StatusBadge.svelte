<script lang="ts">
	import Badge from './ui/Badge.svelte';

	interface Props {
		status: 'PENDING' | 'CATEGORIZED';
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	const variantMap = {
		PENDING: 'warning',
		CATEGORIZED: 'success'
	} as const;

	const labelMap = {
		PENDING: 'Pending',
		CATEGORIZED: 'Categorized'
	};
</script>

<Badge variant={variantMap[status]} {size} text={labelMap[status]} />
