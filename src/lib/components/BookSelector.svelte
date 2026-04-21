<script lang="ts">
	import { ChevronDown, Book } from 'lucide-svelte';
	import { scale } from 'svelte/transition';
	import { portal } from '$lib/actions/portal';
	import type { Book as BookType } from '@prisma/client';

	interface Props {
		books: BookType[];
		currentBookId: string;
		collapsed?: boolean;
		onmanage: () => void;
	}

	let { books, currentBookId, collapsed = false, onmanage }: Props = $props();

	let open = $state(false);
	let containerRef: HTMLDivElement;
	let dropdownStyle = $state('');

	const currentBook = $derived(books.find(b => b.id === currentBookId));

	function updatePosition() {
		if (!containerRef) return;
		const rect = containerRef.getBoundingClientRect();
		dropdownStyle = `
			position: fixed;
			top: ${rect.bottom + 4}px;
			left: ${rect.left}px;
			min-width: 200px;
		`;
	}

	function toggle() {
		open = !open;
		if (open) updatePosition();
	}

	function selectBook(bookId: string) {
		if (bookId === currentBookId) {
			open = false;
			return;
		}
		document.cookie = `bookId=${bookId};path=/;max-age=31536000`;
		window.location.href = '/';
	}

	function handleManage() {
		open = false;
		onmanage();
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerRef && !containerRef.contains(e.target as Node)) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="book-selector" bind:this={containerRef}>
	<button
		class="selector-trigger"
		class:collapsed
		onclick={toggle}
		title={collapsed ? currentBook?.name : undefined}
	>
		{#if collapsed}
			<Book size={18} />
		{:else}
			<span class="book-name">{currentBook?.name ?? 'Select Book'}</span>
			<ChevronDown size={16} />
		{/if}
	</button>

	{#if open}
		<div
			class="dropdown-menu"
			style={dropdownStyle}
			use:portal={'body'}
			transition:scale|global={{ duration: 150, start: 0.95 }}
		>
			<ul class="book-list">
				{#each books as book (book.id)}
					<li>
						<button
							class="book-option"
							class:selected={book.id === currentBookId}
							onclick={() => selectBook(book.id)}
						>
							{book.name}
							{#if book.isDemo}
								<span class="demo-badge">demo</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			<div class="dropdown-divider"></div>
			<button class="manage-link" onclick={handleManage}>
				Manage Books
			</button>
		</div>
	{/if}
</div>

<style>
	.book-selector {
		position: relative;
	}

	.selector-trigger {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-size: 14px;
	}

	.selector-trigger:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-text-muted);
	}

	.selector-trigger.collapsed {
		justify-content: center;
		padding: var(--spacing-sm);
	}

	.book-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dropdown-menu {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		z-index: 9999;
		overflow: hidden;
	}

	.book-list {
		list-style: none;
		margin: 0;
		padding: var(--spacing-xs) 0;
	}

	.book-option {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		color: var(--color-text);
	}

	.book-option:hover {
		background: var(--color-bg-alt);
	}

	.book-option.selected {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.demo-badge {
		font-size: 11px;
		padding: 1px 6px;
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--color-border);
		margin: var(--spacing-xs) 0;
	}

	.manage-link {
		display: block;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.manage-link:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}
</style>
