<script lang="ts" generics="T">
	interface Props {
		items: T[];
		hasMore?: boolean;
		loadMore?: () => Promise<void>;
		children: import('svelte').Snippet<[T, number]>;
	}

	let { items, hasMore = false, loadMore, children }: Props = $props();

	let sentinel: HTMLTableRowElement | null = $state(null);
	let loading = $state(false);

	async function handleLoadMore() {
		if (loading || !loadMore) return;
		loading = true;
		try {
			await loadMore();
		} finally {
			loading = false;
		}
	}

	// Observe sentinel for infinite scroll
	$effect(() => {
		if (!sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore && !loading) {
					handleLoadMore();
				}
			},
			{ rootMargin: '200px' }
		);

		observer.observe(sentinel);

		return () => observer.disconnect();
	});
</script>

{#each items as item, index (index)}
	{@render children(item, index)}
{/each}

{#if hasMore}
	<tr bind:this={sentinel} class="sentinel">
		<td colspan="100">
			<span class="loading-text">{loading ? 'Loading...' : 'Loading more...'}</span>
		</td>
	</tr>
{/if}

<style>
	.sentinel td {
		text-align: center;
		padding: var(--spacing-md);
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.loading-text {
		opacity: 0.7;
	}
</style>
