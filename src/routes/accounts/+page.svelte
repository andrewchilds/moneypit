<script lang="ts">
	import { ChevronRight, ChevronDown, Plus, Wallet, TrendingUp, CreditCard, Unlock, Wand2 } from "lucide-svelte";
	import AccountTypeBadge from "$lib/components/AccountTypeBadge.svelte";
	import AccountForm from "$lib/components/AccountForm.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import TaxCategoryAutocomplete from "$lib/components/TaxCategoryAutocomplete.svelte";
	import { invalidateAll } from "$app/navigation";
	import { enhance } from "$app/forms";
	import { sessionStore } from "$lib/stores/sessions";
	import { generateSuggestTaxCategoryPrompt } from "$lib/prompts/suggestTaxCategory";

	let { data, form } = $props();

	interface TreeNode {
		id: string;
		type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
		path: string;
		name: string;
		taxCategoryId: string | null;
		last4: string | null;
		assetType: "LIQUID" | "BROKERAGE" | "ROTH_RETIREMENT" | "TAX_DEFERRED" | null;
		children: TreeNode[];
	}

	const assetTypeLabels: Record<string, string> = {
		LIQUID: "Liquid",
		BROKERAGE: "Brokerage",
		ROTH_RETIREMENT: "Roth",
		TAX_DEFERRED: "Tax Deferred"
	};

	let showCreateModal = $state(false);
	let newAccountType = $state("EXPENSE");
	let newAccountPath = $state("");
	let newTaxCategory = $state("");
	let newOpeningBalance = $state("");
	let newLast4 = $state("");
	let newAssetType = $state("");

	// Track manually collapsed nodes (user clicked to collapse)
	let collapsedNodes = $state<Set<string>>(new Set());

	// Collect all node IDs that have children
	function collectParentIds(nodes: TreeNode[]): string[] {
		const ids: string[] = [];
		for (const node of nodes) {
			if (node.children.length > 0) {
				ids.push(node.id);
				ids.push(...collectParentIds(node.children));
			}
		}
		return ids;
	}

	// All parent nodes, derived from data
	const allParentIds = $derived(new Set(collectParentIds(data.tree as TreeNode[])));

	// Expanded = all parents minus manually collapsed
	const expandedNodes = $derived(new Set([...allParentIds].filter((id) => !collapsedNodes.has(id))));

	function getTaxCategoryId(nodeId: string): string {
		const account = data.accounts.find((a) => a.id === nodeId);
		return account?.taxCategoryId ?? "";
	}

	// Group tree by account type
	const treeByType = $derived.by(() => {
		const grouped: Record<string, TreeNode[]> = {
			ASSET: [],
			LIABILITY: [],
			EQUITY: [],
			INCOME: [],
			EXPENSE: []
		};

		for (const node of data.tree as TreeNode[]) {
			if (grouped[node.type]) {
				grouped[node.type].push(node);
			}
		}

		return grouped;
	});

	function toggleNode(id: string) {
		if (collapsedNodes.has(id)) {
			collapsedNodes.delete(id);
		} else {
			collapsedNodes.add(id);
		}
		collapsedNodes = new Set(collapsedNodes);
	}

	function formatBalance(amount: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD"
		}).format(amount);
	}

	function getBalance(id: string): number {
		return data.balances[id] ?? 0;
	}

	function getRuleCount(id: string): number {
		return data.ruleCounts[id] ?? 0;
	}

	function handleCreateSuccess() {
		showCreateModal = false;
		newAccountPath = "";
		newTaxCategory = "";
		newOpeningBalance = "";
		newLast4 = "";
		newAssetType = "";
		invalidateAll();
	}

	const netWorth = $derived(data.totals.ASSET + data.totals.LIABILITY);
	const accessibleNetWorth = $derived(data.liquidAssets + data.totals.LIABILITY);

	async function updateTaxCategory(accountId: string, taxCategoryId: string) {
		const formData = new FormData();
		formData.set("accountId", accountId);
		formData.set("taxCategoryId", taxCategoryId);

		const response = await fetch("?/updateTaxCategory", {
			method: "POST",
			body: formData
		});

		if (response.ok) {
			invalidateAll();
		}
	}

	async function suggestTaxCategory(accountId: string, accountPath: string) {
		const res = await fetch(`/api/suggest-tax-category?accountId=${accountId}`);
		if (!res.ok) {
			console.error("Failed to fetch tax category context");
			return;
		}
		const ctx = await res.json();

		const prompt = generateSuggestTaxCategoryPrompt({
			bookId: ctx.bookId,
			accountId: ctx.account.id,
			accountType: ctx.account.type,
			accountPath: ctx.account.path,
			taxCategories: ctx.taxCategories,
			sampleTransactions: ctx.sampleTransactions,
			transactionCount: ctx.transactionCount
		});

		sessionStore.connect();
		sessionStore.createSession({
			taskType: "suggest",
			title: `Tax Category: ${accountPath}`,
			prompt,
			accountId,
			bookId: ctx.bookId
		});
	}
</script>

<div class="accounts-page">
	<header class="page-header">
		<h1>Accounts</h1>
		<Button variant="primary" onclick={() => (showCreateModal = true)}>
			<Plus size={16} />
			New Account
		</Button>
	</header>

	<StatsGrid>
		<StatCard label="Assets" variant="default">
			{#snippet icon()}<Wallet size={24} />{/snippet}
			{formatBalance(data.totals.ASSET)}
		</StatCard>
		<StatCard label="Liabilities" variant="liability">
			{#snippet icon()}<CreditCard size={24} />{/snippet}
			{formatBalance(data.totals.LIABILITY)}
		</StatCard>
		<StatCard label="Net Worth" variant={netWorth >= 0 ? "positive" : "negative"}>
			{#snippet icon()}<TrendingUp size={24} />{/snippet}
			{formatBalance(netWorth)}
		</StatCard>
		<StatCard label="Accessible" variant={accessibleNetWorth >= 0 ? "positive" : "negative"}>
			{#snippet icon()}<Unlock size={24} />{/snippet}
			{formatBalance(accessibleNetWorth)}
		</StatCard>
	</StatsGrid>

	<div class="account-tree">
		{#each Object.entries(treeByType) as [type, nodes] (type)}
			{#if nodes.length > 0}
				{@const showBalance = type === "ASSET" || type === "LIABILITY"}
				<section class="type-section">
					<h2 class="type-header">
						<AccountTypeBadge type={type as TreeNode["type"]} size="md" />
						<span class="type-count">({nodes.length})</span>
					</h2>

					<ul class="tree-list">
						{#each nodes as node (node.id)}
							{@render treeNode(node, 0, showBalance)}
						{/each}
					</ul>
				</section>
			{/if}
		{/each}

		{#if data.tree.length === 0}
			<div class="empty-state">
				<Wallet size={48} strokeWidth={1} />
				<h3>No accounts yet</h3>
				<p>Create your first account to get started</p>
				<Button variant="primary" onclick={() => (showCreateModal = true)}>
					<Plus size={16} />
					Create Account
				</Button>
			</div>
		{/if}
	</div>
</div>

{#snippet treeNode(node: TreeNode, depth: number, showBalance: boolean)}
	{@const isVirtual = node.id.startsWith("virtual:")}
	<li class="tree-node">
		<div class="node-row" style="--indent: {depth * 20}px">
			<div class="col-name">
				{#if node.children.length > 0}
					<button
						class="expand-btn"
						onclick={() => toggleNode(node.id)}
						aria-label={expandedNodes.has(node.id) ? "Collapse" : "Expand"}
					>
						{#if expandedNodes.has(node.id)}
							<ChevronDown size={16} />
						{:else}
							<ChevronRight size={16} />
						{/if}
					</button>
				{:else}
					<span class="expand-spacer"></span>
				{/if}

				{#if isVirtual}
					<span class="node-name virtual">{node.name}</span>
				{:else}
					<a href="/accounts/{node.id}" class="node-link">
						<span class="node-name">{node.name}</span>
						{#if node.last4}
							<span class="node-last4">&bull;&bull;{node.last4}</span>
						{/if}
					</a>
				{/if}
			</div>

			{#if !isVirtual}
				<div class="col-asset-type">
					{#if node.assetType}
						<Badge text={assetTypeLabels[node.assetType]} size="sm" />
					{:else}
						<span class="placeholder">—</span>
					{/if}
				</div>
				<div class="col-tax-category">
					<TaxCategoryAutocomplete
						taxCategories={data.taxCategories}
						size="sm"
						value={getTaxCategoryId(node.id)}
						maxWidth="180px"
						onchange={(value) => updateTaxCategory(node.id, value)}
					/>
					{#if !getTaxCategoryId(node.id)}
						<button
							class="suggest-btn"
							title="Suggest tax category"
							onclick={() => suggestTaxCategory(node.id, node.path)}
						>
							<Wand2 size={14} />
						</button>
					{/if}
				</div>
				<div class="col-rules">
					<span class="node-rules" class:has-rules={getRuleCount(node.id) > 0} title="{getRuleCount(node.id)} rule{getRuleCount(node.id) !== 1 ? 's' : ''}">
						{getRuleCount(node.id) > 0 ? getRuleCount(node.id) : "—"}
					</span>
				</div>
				<div class="col-balance">
					{#if showBalance}
						<span class="node-balance" class:negative={getBalance(node.id) < 0}>
							{formatBalance(getBalance(node.id))}
						</span>
					{:else}
						<span class="placeholder">—</span>
					{/if}
				</div>
			{/if}
		</div>

		{#if node.children.length > 0 && expandedNodes.has(node.id)}
			<ul class="tree-list">
				{#each node.children as child (child.id)}
					{@render treeNode(child, depth + 1, showBalance)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<Modal bind:open={showCreateModal} title="Create Account" onclose={() => (showCreateModal = false)}>
	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === "success") {
					handleCreateSuccess();
				}
			};
		}}
	>
		<AccountForm
			bind:type={newAccountType}
			bind:path={newAccountPath}
			bind:taxCategoryId={newTaxCategory}
			bind:openingBalance={newOpeningBalance}
			bind:last4={newLast4}
			bind:assetType={newAssetType}
			taxCategories={data.taxCategories}
			error={form?.error}
			submitLabel="Create"
			oncancel={() => (showCreateModal = false)}
		/>
	</form>
</Modal>

<style>
	.accounts-page {
		width: 100%;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-lg);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
	}

	.type-section {
		margin-bottom: var(--spacing-lg);
	}

	.type-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin: 0 0 var(--spacing-sm);
		font-size: 14px;
		font-weight: 600;
	}

	.type-count {
		color: var(--color-text-muted);
		font-weight: normal;
	}

	.tree-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tree-node {
		border-bottom: 1px solid var(--color-border-light);
	}

	.tree-node:last-child {
		border-bottom: none;
	}

	.node-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-sm);
	}

	.node-row:hover {
		background: var(--color-bg-alt);
	}

	.col-name {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding-left: var(--indent);
	}

	.col-asset-type {
		width: 90px;
		display: flex;
		justify-content: center;
	}

	.col-tax-category {
		width: 180px;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.col-rules {
		width: 40px;
		text-align: center;
	}

	.col-balance {
		width: 100px;
		text-align: right;
	}

	.placeholder {
		color: var(--color-text-muted);
	}

	.expand-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.expand-btn:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}

	.expand-spacer {
		width: 24px;
		flex-shrink: 0;
	}

	.node-link {
		color: var(--color-text);
		text-decoration: none;
	}

	.node-link:hover {
		color: var(--color-primary);
	}

	.node-name {
		font-weight: 500;
	}

	.node-name.virtual {
		color: var(--color-text-muted);
	}

	.node-last4 {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-left: var(--spacing-xs);
	}

	.suggest-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.suggest-btn:hover {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.node-rules {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.node-rules.has-rules {
		color: var(--color-text);
	}

	.node-balance {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.node-balance.negative {
		color: var(--color-danger);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-text-muted);
	}

	.empty-state h3 {
		margin: var(--spacing-md) 0 var(--spacing-xs);
		color: var(--color-text);
	}

	.empty-state p {
		margin: 0 0 var(--spacing-lg);
	}
</style>
