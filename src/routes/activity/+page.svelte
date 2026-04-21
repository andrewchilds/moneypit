<script lang="ts">
	import { History, Undo2, ChevronDown, ChevronRight } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import { showToast } from '$lib/components/ui/Toast.svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let expandedId = $state<string | null>(null);
	let undoingId = $state<string | null>(null);
	let detailTabs = $state<Record<string, 'table' | 'json'>>({});
	let selectedTxId = $state<string | null>(null);
	let txModalData = $state<{
		description: string;
		date: string;
		amount: number;
		memo?: string;
		debitAccount?: { path: string } | null;
		creditAccount?: { path: string } | null;
	} | null>(null);
	let txModalLoading = $state(false);

	// Fields that contain entity IDs
	const ID_FIELDS: Record<string, string> = {
		debitAccountId: 'Account',
		creditAccountId: 'Account',
		accountId: 'Account',
		taxCategoryId: 'TaxCategory',
		mergedIntoId: 'Transaction'
	};

	function isIdField(field: string): boolean {
		return field in ID_FIELDS;
	}

	function resolveEntityId(id: string): string {
		return data.entityNames[id] || id;
	}

	async function openTxModal(txId: string) {
		selectedTxId = txId;
		txModalLoading = true;
		txModalData = null;

		try {
			const res = await fetch(`/api/transactions/${txId}`);
			if (res.ok) {
				txModalData = await res.json();
			}
		} catch {
			// Silent fail, just show what we have
		} finally {
			txModalLoading = false;
		}
	}

	function closeTxModal() {
		selectedTxId = null;
		txModalData = null;
	}

	function formatDate(iso: string): string {
		const date = new Date(iso);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
		});
	}

	function formatFullDate(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function getOperationVariant(op: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
		switch (op) {
			case 'CREATE':
				return 'success';
			case 'DELETE':
				return 'danger';
			case 'UPDATE':
			case 'CATEGORIZE':
			case 'MERGE':
				return 'info';
			case 'IMPORT':
				return 'warning';
			case 'UNDO':
				return 'default';
			default:
				return 'default';
		}
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	async function handleUndo(id: string) {
		undoingId = id;

		const formData = new FormData();
		formData.append('id', id);

		try {
			const response = await fetch('?/undo', {
				method: 'POST',
				body: formData,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = await response.json();

			if (result.type === 'success') {
				const { undone, skipped } = result.data;
				let message = `Undone ${undone} change${undone !== 1 ? 's' : ''}`;
				if (skipped > 0) {
					message += ` (${skipped} skipped)`;
				}
				showToast('success', message);
				invalidateAll();
			} else {
				showToast('error', result.data?.error || 'Failed to undo');
			}
		} catch {
			showToast('error', 'Failed to undo operation');
		} finally {
			undoingId = null;
		}
	}

	function formatChanges(changes: unknown[]): string {
		return JSON.stringify(changes, null, 2);
	}

	function getChangesSummary(changes: unknown[]): string {
		const count = changes.length;
		return `${count} change${count !== 1 ? 's' : ''}`;
	}

	interface Change {
		entityType: string;
		entityId: string;
		before: Record<string, unknown> | null;
		after: Record<string, unknown> | null;
	}

	function getChangeType(change: Change): 'created' | 'updated' | 'deleted' {
		if (change.before === null) return 'created';
		if (change.after === null) return 'deleted';
		return 'updated';
	}

	function getChangeVariant(type: 'created' | 'updated' | 'deleted'): 'success' | 'info' | 'danger' {
		switch (type) {
			case 'created':
				return 'success';
			case 'deleted':
				return 'danger';
			case 'updated':
				return 'info';
		}
	}

	function getChangeDisplayName(change: Change): string {
		const changeData = change.after ?? change.before;
		if (!changeData) return resolveEntityId(change.entityId);

		switch (change.entityType) {
			case 'Account':
				return (changeData.path as string) || resolveEntityId(change.entityId);
			case 'Transaction':
				return (changeData.description as string) || resolveEntityId(change.entityId);
			case 'Rule':
				return (changeData.pattern as string) || resolveEntityId(change.entityId);
			case 'TaxCategory':
				return (changeData.name as string) || resolveEntityId(change.entityId);
			case 'BalanceRecord':
				return `Balance ${(changeData.date as string)?.slice(0, 10) || resolveEntityId(change.entityId)}`;
			default:
				return resolveEntityId(change.entityId);
		}
	}

	function formatValue(value: unknown, field?: string): string {
		if (value === null || value === undefined) return '—';
		if (typeof value === 'string') {
			// If it's an ID field, try to resolve it
			if (field && isIdField(field)) {
				return data.entityNames[value] || value;
			}
			// Truncate long strings
			if (value.length > 50) return value.slice(0, 47) + '...';
			return value;
		}
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		if (typeof value === 'number') return String(value);
		return JSON.stringify(value);
	}

	function getChangedFields(change: Change): Array<{ field: string; before: unknown; after: unknown }> {
		const before = change.before ?? {};
		const after = change.after ?? {};
		const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
		const fields: Array<{ field: string; before: unknown; after: unknown }> = [];

		for (const key of allKeys) {
			// Skip internal fields
			if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;

			const beforeVal = before[key];
			const afterVal = after[key];

			// Only show if there's a difference or it's a create/delete
			if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
				fields.push({ field: key, before: beforeVal, after: afterVal });
			}
		}

		return fields;
	}

	function getDetailTab(id: string): 'table' | 'json' {
		return detailTabs[id] ?? 'table';
	}

	function setDetailTab(id: string, tab: 'table' | 'json') {
		detailTabs[id] = tab;
	}
</script>

<div class="activity-page">
	<header class="page-header">
		<div class="header-info">
			<History size={24} />
			<h1>Activity Log</h1>
		</div>
	</header>

	{#if data.operations.length === 0}
		<div class="empty-state">
			<History size={48} strokeWidth={1} />
			<h3>No activity yet</h3>
			<p>Operations will appear here as you make changes.</p>
		</div>
	{:else}
		<div class="operations-container">
			<Pagination currentPage={data.page} totalPages={data.totalPages} total={data.total} />

			<div class="operations-list">
			{#each data.operations as op (op.id)}
				{@const isExpanded = expandedId === op.id}
				{@const isUndoing = undoingId === op.id}
				{@const canUndo = op.operation !== 'IMPORT'}
				{@const changes = op.changes as unknown[]}

				<div class="operation" class:undone={op.undoneAt}>
					<button class="operation-header" onclick={() => toggleExpand(op.id)}>
						<span class="expand-icon">
							{#if isExpanded}
								<ChevronDown size={16} />
							{:else}
								<ChevronRight size={16} />
							{/if}
						</span>

						<Badge variant={getOperationVariant(op.operation)} text={op.operation} size="sm" />

						<span class="operation-desc">{op.description}</span>

						<span class="operation-meta">
							<span class="changes-count">{getChangesSummary(changes)}</span>
							<span class="operation-time" title={formatFullDate(op.createdAt)}>
								{formatDate(op.createdAt)}
							</span>
						</span>

						{#if op.undoneAt}
							<Badge variant="default" text="Undone" size="sm" />
						{/if}
					</button>

					{#if isExpanded}
					{@const activeTab = getDetailTab(op.id)}
						<div class="operation-details">
							<div class="details-header">
								<div class="details-left">
									<span class="details-time">{formatFullDate(op.createdAt)}</span>
									<div class="detail-tabs">
										<button
											class="detail-tab"
											class:active={activeTab === 'table'}
											onclick={() => setDetailTab(op.id, 'table')}
										>
											Table
										</button>
										<button
											class="detail-tab"
											class:active={activeTab === 'json'}
											onclick={() => setDetailTab(op.id, 'json')}
										>
											JSON
										</button>
									</div>
								</div>
								{#if canUndo}
									<Button
										variant="secondary"
										size="sm"
										disabled={isUndoing}
										onclick={() => handleUndo(op.id)}
									>
										<Undo2 size={14} />
										{isUndoing ? 'Undoing...' : 'Undo'}
									</Button>
								{:else}
									<span class="no-undo">Imports cannot be undone</span>
								{/if}
							</div>

							{#if activeTab === 'table'}
								<div class="changes-table-container">
									{#each changes as change, i (i)}
										{@const typedChange = change as Change}
										{@const changeType = getChangeType(typedChange)}
										{@const changedFields = getChangedFields(typedChange)}
										<div class="entity-change">
											<div class="entity-header">
												<Badge variant={getChangeVariant(changeType)} text={changeType} size="sm" />
												<span class="entity-type">{typedChange.entityType}</span>
												{#if typedChange.entityType === 'Transaction'}
													<button class="entity-name entity-link" onclick={() => openTxModal(typedChange.entityId)}>
														{getChangeDisplayName(typedChange)}
													</button>
												{:else}
													<span class="entity-name">{getChangeDisplayName(typedChange)}</span>
												{/if}
											</div>
											{#if changedFields.length > 0}
												<table class="changes-table">
													<thead>
														<tr>
															<th>Field</th>
															<th>Before</th>
															<th>After</th>
														</tr>
													</thead>
													<tbody>
														{#each changedFields as { field, before, after } (field)}
															<tr>
																<td class="field-name">{field}</td>
																<td class="field-before">{formatValue(before, field)}</td>
																<td class="field-after">{formatValue(after, field)}</td>
															</tr>
														{/each}
													</tbody>
												</table>
											{/if}
										</div>
									{/each}
								</div>
							{:else}
								<pre class="changes-json">{formatChanges(changes)}</pre>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

			<Pagination currentPage={data.page} totalPages={data.totalPages} total={data.total} />
		</div>
	{/if}
</div>

<Modal open={selectedTxId !== null} title="Transaction Details" onclose={closeTxModal}>
	{#if txModalLoading}
		<p class="loading-text">Loading...</p>
	{:else if txModalData}
		<dl class="tx-details">
			<div class="tx-detail-row">
				<dt>Description</dt>
				<dd>{txModalData.description}</dd>
			</div>
			<div class="tx-detail-row">
				<dt>Date</dt>
				<dd>{typeof txModalData.date === 'string' ? txModalData.date.slice(0, 10) : ''}</dd>
			</div>
			<div class="tx-detail-row">
				<dt>Amount</dt>
				<dd class="amount">${Number(txModalData.amount).toFixed(2)}</dd>
			</div>
			<div class="tx-detail-row">
				<dt>Debit</dt>
				<dd>{txModalData.debitAccount?.path ?? '—'}</dd>
			</div>
			<div class="tx-detail-row">
				<dt>Credit</dt>
				<dd>{txModalData.creditAccount?.path ?? '—'}</dd>
			</div>
			{#if txModalData.memo}
				<div class="tx-detail-row">
					<dt>Memo</dt>
					<dd>{txModalData.memo}</dd>
				</div>
			{/if}
		</dl>
		<div class="tx-modal-actions">
			<a href="/transactions/{selectedTxId}" class="view-link">View transaction →</a>
		</div>
	{:else}
		<p class="error-text">Transaction not found</p>
	{/if}
</Modal>

<style>
	.activity-page {
		max-width: 900px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-lg);
	}

	.header-info {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
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
		margin: 0;
	}

	.operations-container {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.operations-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: var(--color-border-light);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.operation {
		background: var(--color-bg);
	}

	.operation.undone {
		opacity: 0.6;
	}

	.operation-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
	}

	.operation-header:hover {
		background: var(--color-bg-alt);
	}

	.expand-icon {
		display: flex;
		color: var(--color-text-muted);
	}

	.operation-desc {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.operation-meta {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.changes-count {
		color: var(--color-text-light);
	}

	.operation-time {
		min-width: 60px;
		text-align: right;
	}

	.operation-details {
		padding: var(--spacing-md);
		padding-top: 0;
		border-top: 1px solid var(--color-border-light);
		margin-top: var(--spacing-xs);
	}

	.details-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-sm);
	}

	.details-time {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.no-undo {
		font-size: 13px;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.changes-json {
		margin: 0;
		padding: var(--spacing-sm);
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 12px;
		overflow-x: auto;
		max-height: 300px;
		overflow-y: auto;
	}

	.details-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.detail-tabs {
		display: flex;
		gap: 2px;
		background: var(--color-bg-alt);
		padding: 2px;
		border-radius: var(--radius-sm);
	}

	.detail-tab {
		padding: 4px 10px;
		font-size: 12px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-xs);
	}

	.detail-tab:hover {
		color: var(--color-text);
	}

	.detail-tab.active {
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.changes-table-container {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.entity-change {
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.entity-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.entity-type {
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.entity-name {
		font-weight: 500;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.changes-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.changes-table th {
		text-align: left;
		padding: 6px 8px;
		font-weight: 500;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border-light);
	}

	.changes-table td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--color-border-light);
		vertical-align: top;
	}

	.changes-table tr:last-child td {
		border-bottom: none;
	}

	.field-name {
		font-weight: 500;
		color: var(--color-text-light);
		white-space: nowrap;
	}

	.field-before {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-danger);
		word-break: break-word;
	}

	.field-after {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-success);
		word-break: break-word;
	}

	.entity-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-primary);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s;
	}

	.entity-link:hover {
		text-decoration-color: currentColor;
	}

	.loading-text,
	.error-text {
		text-align: center;
		color: var(--color-text-muted);
		padding: var(--spacing-md);
	}

	.tx-details {
		margin: 0;
	}

	.tx-detail-row {
		display: flex;
		padding: var(--spacing-xs) 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.tx-detail-row:last-child {
		border-bottom: none;
	}

	.tx-detail-row dt {
		width: 100px;
		flex-shrink: 0;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.tx-detail-row dd {
		margin: 0;
		flex: 1;
	}

	.tx-detail-row .amount {
		font-family: var(--font-mono);
		font-weight: 500;
	}

	.tx-modal-actions {
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}

	.view-link {
		color: var(--color-primary);
		font-size: 13px;
	}
</style>
