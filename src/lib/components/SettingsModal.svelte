<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { Pencil, Trash2, Plus, Check, X, ChevronDown, ChevronRight, Loader2, Download, Upload } from 'lucide-svelte';
	import type { Book } from '@prisma/client';
	import { invalidateAll } from '$app/navigation';
	import type { TaxModule } from '$lib/server/taxModules';

	interface ModuleWithStatus {
		module: TaxModule;
		enabled: boolean;
		enabledAt: Date | null;
	}

	interface Props {
		open: boolean;
		books: Book[];
		currentBookId: string;
		initialTab?: string;
		onclose: () => void;
	}

	let { open = $bindable(), books, currentBookId, initialTab, onclose }: Props = $props();

	// Set initial tab when modal opens with initialTab set
	$effect(() => {
		if (open && initialTab) {
			activeTab = initialTab;
		}
	});

	let activeTab = $state('books');
	let editingId = $state<string | null>(null);
	let editingName = $state('');
	let newBookName = $state('');
	let isCreating = $state(false);
	let isLoading = $state(false);

	// Tax modules state
	let modulesData = $state<ModuleWithStatus[]>([]);
	let loadingModules = $state(false);
	let togglingModule = $state<string | null>(null);
	let expandedModules = $state<Set<string>>(new Set());

	const tabs = [
		{ id: 'books', label: 'Books' },
		{ id: 'tax-modules', label: 'Tax Modules' },
		{ id: 'data', label: 'Data' }
	];

	// Data tab state
	let exporting = $state(false);
	let importing = $state(false);
	let importError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function exportCurrentBook() {
		exporting = true;
		try {
			const res = await fetch(`/api/books/${currentBookId}/export`);
			if (!res.ok) throw new Error('Export failed');
			const data = await res.json();

			// Download as file
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			const bookName = books.find(b => b.id === currentBookId)?.name ?? 'book';
			const date = new Date().toISOString().split('T')[0];
			a.href = url;
			a.download = `${bookName.toLowerCase().replace(/\s+/g, '-')}-${date}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error('Export error:', err);
		} finally {
			exporting = false;
		}
	}

	function triggerFileSelect() {
		fileInput?.click();
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importError = null;
		importSuccess = null;
		importing = true;

		try {
			const text = await file.text();
			const data = JSON.parse(text);

			const res = await fetch('/api/books/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ data })
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.message || 'Import failed');
			}

			const result = await res.json();
			importSuccess = `Imported "${result.bookName}" with ${result.accounts} accounts and ${result.transactions} transactions`;
			await invalidateAll();
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Import failed';
		} finally {
			importing = false;
			// Reset file input
			input.value = '';
		}
	}

	const groupLabels: Record<string, string> = {
		'us-federal': 'US Federal',
		'us-state': 'US State',
		'corporate': 'Corporate'
	};

	async function loadModules() {
		if (!currentBookId) return;
		loadingModules = true;
		try {
			const res = await fetch(`/api/tax-modules?bookId=${currentBookId}`);
			if (res.ok) {
				modulesData = await res.json();
			}
		} finally {
			loadingModules = false;
		}
	}

	async function toggleModule(moduleId: string, currentlyEnabled: boolean) {
		togglingModule = moduleId;
		try {
			const res = await fetch('/api/tax-modules', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					bookId: currentBookId,
					moduleId,
					action: currentlyEnabled ? 'disable' : 'enable'
				})
			});
			if (res.ok) {
				await loadModules();
			}
		} finally {
			togglingModule = null;
		}
	}

	function toggleExpand(moduleId: string) {
		if (expandedModules.has(moduleId)) {
			expandedModules.delete(moduleId);
		} else {
			expandedModules.add(moduleId);
		}
		expandedModules = new Set(expandedModules);
	}

	// Track the book we loaded modules for
	let loadedForBookId = $state<string | null>(null);

	$effect(() => {
		// Reload modules when switching to the tab OR when the book changes
		if (activeTab === 'tax-modules' && currentBookId !== loadedForBookId) {
			loadedForBookId = currentBookId;
			loadModules();
		}
	});

	// Get current book name for display
	const currentBookName = $derived(books.find(b => b.id === currentBookId)?.name ?? 'Unknown');

	function startEdit(book: Book) {
		editingId = book.id;
		editingName = book.name;
	}

	function cancelEdit() {
		editingId = null;
		editingName = '';
	}

	async function saveEdit() {
		if (!editingId || !editingName.trim()) return;
		isLoading = true;
		try {
			const res = await fetch(`/api/books/${editingId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editingName.trim() })
			});
			if (res.ok) {
				await invalidateAll();
				editingId = null;
				editingName = '';
			}
		} finally {
			isLoading = false;
		}
	}

	async function deleteBook(id: string) {
		if (id === currentBookId) {
			alert('Cannot delete the currently active book. Switch to another book first.');
			return;
		}
		if (books.length <= 1) {
			alert('Cannot delete the last book.');
			return;
		}
		const book = books.find(b => b.id === id);
		if (!confirm(`Delete "${book?.name}"? This will delete all accounts, transactions, and rules in this book.`)) {
			return;
		}
		isLoading = true;
		try {
			const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await invalidateAll();
			}
		} finally {
			isLoading = false;
		}
	}

	async function createBook() {
		if (!newBookName.trim()) return;
		isLoading = true;
		try {
			const res = await fetch('/api/books', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newBookName.trim() })
			});
			if (res.ok) {
				await invalidateAll();
				newBookName = '';
				isCreating = false;
			}
		} finally {
			isLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (editingId) saveEdit();
			else if (isCreating) createBook();
		} else if (e.key === 'Escape') {
			if (editingId) cancelEdit();
			else if (isCreating) {
				isCreating = false;
				newBookName = '';
			}
		}
	}
</script>

<Modal {open} title="Settings" {onclose}>
	<Tabs {tabs} bind:value={activeTab} />

	{#if activeTab === 'tax-modules'}
		<div class="modules-section">
			<p class="book-context">Tax modules for <strong>{currentBookName}</strong></p>
			{#if loadingModules}
				<div class="loading">
					<Loader2 size={20} class="spinner" />
					Loading modules...
				</div>
			{:else}
				{#each ['us-federal', 'us-state', 'corporate'] as group (group)}
					{@const groupModules = modulesData.filter(m => m.module.group === group)}
					{#if groupModules.length > 0}
						<div class="module-group">
							<h3 class="group-title">{groupLabels[group]}</h3>
							{#each groupModules as { module, enabled } (module.id)}
								<div class="module-item">
									<div class="module-header">
										<button
											class="expand-btn"
											onclick={() => toggleExpand(module.id)}
										>
											{#if expandedModules.has(module.id)}
												<ChevronDown size={16} />
											{:else}
												<ChevronRight size={16} />
											{/if}
										</button>
										<div class="module-info">
											<span class="module-name">{module.name}</span>
											<span class="module-desc">{module.description}</span>
										</div>
										<label class="toggle">
											<input
												type="checkbox"
												checked={enabled}
												disabled={togglingModule === module.id}
												onchange={() => toggleModule(module.id, enabled)}
											/>
											<span class="toggle-slider"></span>
										</label>
									</div>
									{#if expandedModules.has(module.id)}
										<div class="module-categories">
											<div class="categories-header">
												{module.categories.length} categories:
											</div>
											<ul class="categories-list">
												{#each module.categories as cat (cat.name)}
													<li>
														<span class="cat-name">{cat.name}</span>
														<span class="cat-ref">{cat.scheduleRef}</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	{:else if activeTab === 'data'}
		<div class="data-section">
			<p class="book-context">Data operations for <strong>{currentBookName}</strong></p>

			<div class="data-card">
				<h3>Export Book</h3>
				<p>Download all data from the current book as a JSON file. Includes accounts, transactions, rules, tax categories, and balance records.</p>
				<Button onclick={exportCurrentBook} disabled={exporting}>
					{#if exporting}
						<Loader2 size={16} class="spinner" />
						Exporting...
					{:else}
						<Download size={16} />
						Export to JSON
					{/if}
				</Button>
			</div>

			<div class="data-card">
				<h3>Import Book</h3>
				<p>Import a previously exported book. This creates a new book with all the data from the export file.</p>
				<input
					type="file"
					accept=".json"
					bind:this={fileInput}
					onchange={handleFileSelect}
					style="display: none;"
				/>
				<Button onclick={triggerFileSelect} disabled={importing}>
					{#if importing}
						<Loader2 size={16} class="spinner" />
						Importing...
					{:else}
						<Upload size={16} />
						Import from JSON
					{/if}
				</Button>
				{#if importError}
					<p class="import-error">{importError}</p>
				{/if}
				{#if importSuccess}
					<p class="import-success">{importSuccess}</p>
				{/if}
			</div>
		</div>
	{:else if activeTab === 'books'}
		<div class="books-section">
			<ul class="books-list">
				{#each books as book (book.id)}
					<li class="book-item">
						{#if editingId === book.id}
							<input
								type="text"
								bind:value={editingName}
								onkeydown={handleKeydown}
								class="edit-input"
								disabled={isLoading}
							/>
							<button class="icon-btn save" onclick={saveEdit} disabled={isLoading}>
								<Check size={16} />
							</button>
							<button class="icon-btn cancel" onclick={cancelEdit} disabled={isLoading}>
								<X size={16} />
							</button>
						{:else}
							<span class="book-name">
								{book.name}
								{#if book.id === currentBookId}
									<span class="current-badge">current</span>
								{/if}
								{#if book.isDemo}
									<span class="demo-badge">demo</span>
								{/if}
							</span>
							<button class="icon-btn edit" onclick={() => startEdit(book)}>
								<Pencil size={14} />
							</button>
							<button
								class="icon-btn delete"
								onclick={() => deleteBook(book.id)}
								disabled={book.id === currentBookId || books.length <= 1}
							>
								<Trash2 size={14} />
							</button>
						{/if}
					</li>
				{/each}
			</ul>

			{#if isCreating}
				<div class="new-book-form">
					<input
						type="text"
						bind:value={newBookName}
						placeholder="Book name"
						onkeydown={handleKeydown}
						class="edit-input"
						disabled={isLoading}
					/>
					<button class="icon-btn save" onclick={createBook} disabled={isLoading || !newBookName.trim()}>
						<Check size={16} />
					</button>
					<button class="icon-btn cancel" onclick={() => { isCreating = false; newBookName = ''; }}>
						<X size={16} />
					</button>
				</div>
			{:else}
				<Button variant="ghost" onclick={() => { isCreating = true; }}>
					<Plus size={16} />
					Add Book
				</Button>
			{/if}
		</div>
	{/if}
</Modal>

<style>
	.books-section {
		margin-top: var(--spacing-md);
	}

	.books-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.book-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.book-item:last-child {
		border-bottom: none;
	}

	.book-name {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.current-badge,
	.demo-badge {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.current-badge {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.demo-badge {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
	}

	.edit-input {
		flex: 1;
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: inherit;
	}

	.edit-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.icon-btn.save {
		color: var(--color-success);
	}

	.icon-btn.delete:hover:not(:disabled) {
		color: var(--color-danger);
	}

	.new-book-form {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	/* Tax Modules styles */
	.modules-section {
		margin-top: var(--spacing-md);
	}

	.book-context {
		margin: 0 0 var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.book-context strong {
		color: var(--color-text);
	}

	.loading {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--color-text-muted);
		padding: var(--spacing-lg);
		justify-content: center;
	}

	.loading :global(.spinner) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.module-group {
		margin-bottom: var(--spacing-lg);
	}

	.group-title {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-muted);
		margin: 0 0 var(--spacing-sm);
	}

	.module-item {
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		margin-bottom: var(--spacing-sm);
		overflow: hidden;
	}

	.module-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.expand-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
	}

	.expand-btn:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.module-info {
		flex: 1;
		min-width: 0;
	}

	.module-name {
		font-weight: 500;
		display: block;
	}

	.module-desc {
		font-size: 12px;
		color: var(--color-text-muted);
		display: block;
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 22px;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-border);
		border-radius: 11px;
		transition: background 0.2s;
	}

	.toggle-slider::before {
		position: absolute;
		content: '';
		height: 16px;
		width: 16px;
		left: 3px;
		bottom: 3px;
		background: white;
		border-radius: 50%;
		transition: transform 0.2s;
	}

	.toggle input:checked + .toggle-slider {
		background: var(--color-primary);
	}

	.toggle input:checked + .toggle-slider::before {
		transform: translateX(18px);
	}

	.toggle input:disabled + .toggle-slider {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.module-categories {
		background: var(--color-bg-alt);
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}

	.categories-header {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: var(--spacing-xs);
	}

	.categories-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 200px;
		overflow-y: auto;
	}

	.categories-list li {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		padding: 2px 0;
		gap: var(--spacing-sm);
	}

	.cat-name {
		flex: 1;
	}

	.cat-ref {
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* Data section styles */
	.data-section {
		margin-top: var(--spacing-md);
	}

	.data-card {
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.data-card h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: 14px;
		font-weight: 600;
	}

	.data-card p {
		margin: 0 0 var(--spacing-md);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.data-card :global(button) {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.data-card :global(.spinner) {
		animation: spin 1s linear infinite;
	}

	.import-error {
		color: var(--color-danger);
		margin-top: var(--spacing-sm);
		font-size: 13px;
	}

	.import-success {
		color: var(--color-success);
		margin-top: var(--spacing-sm);
		font-size: 13px;
	}
</style>
