<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import Button from './Button.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	interface Props {
		currentPage: number;
		totalPages: number;
		total: number;
	}

	let { currentPage, totalPages, total }: Props = $props();

	function goToPage(pageNum: number) {
		const url = new URL($page.url);
		if (pageNum === 1) {
			url.searchParams.delete('page');
		} else {
			url.searchParams.set('page', String(pageNum));
		}
		goto(url.toString());
	}
</script>

{#if totalPages > 1}
	<nav class="pagination" aria-label="Pagination">
		<Button
			variant="secondary"
			size="sm"
			disabled={currentPage <= 1}
			onclick={() => goToPage(currentPage - 1)}
		>
			<ChevronLeft size={16} />
			Previous
		</Button>

		<span class="page-info">
			Page {currentPage} of {totalPages}
			<span class="total-count">({total} total)</span>
		</span>

		<Button
			variant="secondary"
			size="sm"
			disabled={currentPage >= totalPages}
			onclick={() => goToPage(currentPage + 1)}
		>
			Next
			<ChevronRight size={16} />
		</Button>
	</nav>
{/if}

<style>
	.pagination {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.page-info {
		font-size: 14px;
		color: var(--color-text-light);
	}

	.total-count {
		color: var(--color-text-muted);
	}
</style>
