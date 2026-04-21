<script lang="ts">
	import { Search, X, Play } from "lucide-svelte";
	import TransactionsTable from "$lib/components/TransactionsTable.svelte";
	import Dropdown from "$lib/components/ui/Dropdown.svelte";
	import DateRangePicker from "$lib/components/DateRangePicker.svelte";
	import AmountRangePicker from "$lib/components/AmountRangePicker.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { showToast } from "$lib/components/ui/Toast.svelte";
	import { goto, invalidateAll } from "$app/navigation";

	type SortColumn = "date" | "amount" | "description";
	type SortOrder = "asc" | "desc";

	let { data } = $props();

	let searchInput = $state("");
	let filterStatus = $state("");
	let filterAccount = $state("");
	let filterFrom = $state("");
	let filterTo = $state("");
	let filterAmountMin = $state("");
	let filterAmountMax = $state("");
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let searchInputEl: HTMLInputElement;

	// Transaction pagination state
	// svelte-ignore state_referenced_locally
	let transactions = $state(data.transactions);
	// svelte-ignore state_referenced_locally
	let nextCursor = $state(data.nextCursor);

	// Reset pagination when data changes (filters applied)
	$effect(() => {
		transactions = data.transactions;
		nextCursor = data.nextCursor;
	});

	// Sync filter inputs with URL params
	$effect(() => {
		searchInput = data.filters.search ?? "";
		filterStatus = data.filters.status ?? "";
		filterAccount = data.filters.accountId ?? "";
		filterFrom = data.filters.from ?? "";
		filterTo = data.filters.to ?? "";
		filterAmountMin = data.filters.amountMin?.toString() ?? "";
		filterAmountMax = data.filters.amountMax?.toString() ?? "";
	});

	async function loadMoreTransactions() {
		if (!nextCursor) return;

		const params = new URLSearchParams();
		params.set("cursor", nextCursor);
		params.set("limit", "100");
		if (filterAccount) params.set("accountId", filterAccount);
		if (filterStatus) params.set("status", filterStatus);
		if (filterFrom) params.set("from", filterFrom);
		if (filterTo) params.set("to", filterTo);
		if (searchInput) params.set("search", searchInput);
		if (filterAmountMin) params.set("amountMin", filterAmountMin);
		if (filterAmountMax) params.set("amountMax", filterAmountMax);
		params.set("sort", data.sort.sortBy);
		params.set("order", data.sort.sortOrder);

		const res = await fetch(`/api/transactions/paginated?${params}`);
		const result = await res.json();

		transactions = [...transactions, ...result.transactions];
		nextCursor = result.nextCursor;
	}

	const statusOptions = [
		{ value: "", label: "All Statuses" },
		{ value: "PENDING", label: "Pending" },
		{ value: "CATEGORIZED", label: "Categorized" }
	];

	const accountOptions = $derived(() => {
		const options: Array<{ value: string; label: string; group?: string }> = [
			{ value: "", label: "All Accounts" },
			{ value: "uncategorized", label: "Uncategorized" }
		];

		// Group accounts by type
		const typeOrder = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
		const typeLabels: Record<string, string> = {
			ASSET: "Assets",
			LIABILITY: "Liabilities",
			EQUITY: "Equity",
			INCOME: "Income",
			EXPENSE: "Expenses"
		};

		for (const type of typeOrder) {
			const accountsOfType = data.accounts.filter((a) => a.type === type);
			for (const account of accountsOfType) {
				options.push({
					value: account.id,
					label: account.path,
					group: typeLabels[type]
				});
			}
		}

		return options;
	});

	function buildUrl(overrides: { sort?: SortColumn; order?: SortOrder } = {}) {
		const params = new URLSearchParams();
		if (searchInput) params.set("search", searchInput);
		if (filterStatus) params.set("status", filterStatus);
		if (filterAccount) params.set("account", filterAccount);
		if (filterFrom) params.set("from", filterFrom);
		if (filterTo) params.set("to", filterTo);
		if (filterAmountMin) params.set("amountMin", filterAmountMin);
		if (filterAmountMax) params.set("amountMax", filterAmountMax);

		const sortBy = overrides.sort ?? data.sort.sortBy;
		const sortOrder = overrides.order ?? data.sort.sortOrder;
		// Only include sort params if not default
		if (sortBy !== "date" || sortOrder !== "desc") {
			params.set("sort", sortBy);
			params.set("order", sortOrder);
		}

		return `/transactions?${params.toString()}`;
	}

	async function applyFilters() {
		const caretPos = searchInputEl?.selectionStart;
		const hadFocus = document.activeElement === searchInputEl;

		await goto(buildUrl(), { keepFocus: true, noScroll: true });

		if (hadFocus && searchInputEl && caretPos !== null) {
			searchInputEl.focus();
			searchInputEl.setSelectionRange(caretPos, caretPos);
		}
	}

	function handleSort(column: SortColumn) {
		const currentSort = data.sort.sortBy;
		const currentOrder = data.sort.sortOrder;

		let newOrder: SortOrder;
		if (currentSort === column) {
			newOrder = currentOrder === "asc" ? "desc" : "asc";
		} else {
			newOrder = column === "description" ? "asc" : "desc";
		}

		goto(buildUrl({ sort: column, order: newOrder }), { noScroll: true });
	}

	function handleDateChange(from: string, to: string) {
		filterFrom = from;
		filterTo = to;
		applyFilters();
	}

	function handleAmountChange(min: string, max: string) {
		filterAmountMin = min;
		filterAmountMax = max;
		applyFilters();
	}

	function handleAccountChange(value: string) {
		filterAccount = value;
		applyFilters();
	}

	function handleStatusChange(value: string) {
		filterStatus = value;
		applyFilters();
	}

	function handleSearchInput() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			applyFilters();
		}, 300);
	}

	function clearSearch() {
		searchInput = "";
		applyFilters();
	}

	async function handleInlineAccountChange(txId: string, side: "debit" | "credit", accountId: string) {
		const formData = new FormData();
		formData.append("ids", txId);
		formData.append("accountId", accountId);
		formData.append("side", side);

		await fetch("?/categorize", {
			method: "POST",
			body: formData
		});
		invalidateAll();
	}

	async function handleApplyAll(side: "debit" | "credit", accountId: string) {
		const uncategorizedIds = transactions
			.filter((tx) => (side === "debit" ? !tx.debitAccount : !tx.creditAccount))
			.map((tx) => tx.id);

		if (uncategorizedIds.length === 0) return;

		const formData = new FormData();
		uncategorizedIds.forEach((id) => formData.append("ids", id));
		formData.append("accountId", accountId);
		formData.append("side", side);

		await fetch("?/categorize", {
			method: "POST",
			body: formData
		});
		invalidateAll();
	}

	async function handleFlip(ids: string[]) {
		if (ids.length === 0) return;

		const formData = new FormData();
		ids.forEach((id) => formData.append("ids", id));

		await fetch("?/flip", {
			method: "POST",
			body: formData
		});
		invalidateAll();
	}

	function handleAccountClick(accountId: string) {
		filterAccount = accountId;
		applyFilters();
	}

	let runningRules = $state(false);

	async function runRules() {
		runningRules = true;
		try {
			const res = await fetch("/api/rules/apply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({})
			});
			const result = await res.json();

			if (result.transactionsUpdated > 0) {
				showToast(
					"success",
					`Applied ${result.rulesApplied} rule${result.rulesApplied !== 1 ? "s" : ""} to ${result.transactionsUpdated} transaction${result.transactionsUpdated !== 1 ? "s" : ""}`
				);
				invalidateAll();
			} else {
				showToast("info", "No pending transactions matched any rules");
			}
		} catch {
			showToast("error", "Failed to run rules");
		} finally {
			runningRules = false;
		}
	}
</script>

<div class="transactions-page">
	<header class="page-header">
		<h1>Transactions</h1>
		<Button variant="secondary" onclick={runRules} disabled={runningRules}>
			<Play size={16} />
			{runningRules ? "Running..." : "Run Rules"}
		</Button>
	</header>

	<div class="filters-bar">
		<div class="filter-group search-group">
			<div class="search-input">
				<Search size={16} />
				<input
					type="text"
					id="search"
					bind:this={searchInputEl}
					bind:value={searchInput}
					placeholder="Search description..."
					onkeyup={handleSearchInput}
				/>
				{#if searchInput}
					<button type="button" class="clear-search" onclick={clearSearch} aria-label="Clear search">
						<X size={16} />
					</button>
				{/if}
			</div>
		</div>

		<div class="filter-group">
			<AmountRangePicker bind:min={filterAmountMin} bind:max={filterAmountMax} onchange={handleAmountChange} />
		</div>

		<div class="filter-group">
			<DateRangePicker bind:from={filterFrom} bind:to={filterTo} onchange={handleDateChange} />
		</div>

		<div class="filter-group">
			<Dropdown
				options={accountOptions()}
				bind:value={filterAccount}
				onchange={handleAccountChange}
				searchable={true}
				searchPlaceholder="Filter accounts..."
				clearable={true}
			/>
		</div>

		<div class="filter-group">
			<Dropdown options={statusOptions} bind:value={filterStatus} onchange={handleStatusChange} clearable={true} />
		</div>
	</div>

	<TransactionsTable
		{transactions}
		accounts={data.accounts}
		showSelection={true}
		editable={true}
		sortBy={data.sort.sortBy}
		sortOrder={data.sort.sortOrder}
		hasMore={!!nextCursor}
		loadMore={loadMoreTransactions}
		hasTextFilter={Boolean(data.filters.search)}
		onsort={handleSort}
		onaccountchange={handleInlineAccountChange}
		onaccountclick={handleAccountClick}
		onapplyall={handleApplyAll}
		onflip={handleFlip}
	/>
</div>

<style>
	.transactions-page {
		max-width: 1400px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-md);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
	}

	.filters-bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.filter-group {
		display: flex;
		align-items: center;
	}

	.filter-group :global(.dropdown-menu) {
		width: 280px;
	}

	.search-group {
		flex: 1;
		min-width: 200px;
		max-width: 300px;
	}

	.search-input {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.search-input :global(svg) {
		position: absolute;
		left: var(--spacing-sm);
		color: var(--color-text-muted);
	}

	.search-input input {
		width: 100%;
		padding-left: 28px;
		padding-right: 28px;
		height: 36px;
	}

	.clear-search {
		position: absolute;
		right: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.clear-search:hover {
		color: var(--color-text);
		background: var(--color-bg-alt);
	}
</style>
