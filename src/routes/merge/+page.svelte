<script lang="ts">
	import { CheckCircle, GitMerge, Ban, ArrowRight } from "lucide-svelte";
	import AccountTypeBadge from "$lib/components/AccountTypeBadge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { showToast } from "$lib/components/ui/Toast.svelte";
	import { invalidateAll } from "$app/navigation";

	let { data } = $props();

	let dismissingPairs = $state<Set<string>>(new Set());
	let isSubmitting = $state<string | null>(null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric"
		});
	}

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD"
		}).format(amount);
	}

	function getScoreColor(score: number): string {
		if (score >= 80) return "var(--color-success)";
		if (score >= 60) return "var(--color-warning)";
		return "var(--color-text-muted)";
	}

	function dismissCard(pairKey: string, callback: () => void) {
		dismissingPairs.add(pairKey);
		dismissingPairs = new Set(dismissingPairs);

		// Wait for animation, then execute callback
		setTimeout(() => {
			callback();
			dismissingPairs.delete(pairKey);
			dismissingPairs = new Set(dismissingPairs);
		}, 300);
	}

	async function handleMerge(tx1Id: string, tx2Id: string) {
		const pairKey = `${tx1Id}:${tx2Id}`;
		if (isSubmitting) return;
		isSubmitting = pairKey;

		const formData = new FormData();
		formData.append("id1", tx1Id);
		formData.append("id2", tx2Id);

		try {
			const response = await fetch("?/merge", {
				method: "POST",
				body: formData,
				headers: { "x-sveltekit-action": "true" }
			});
			const result = await response.json();
			if (result.type === "success") {
				dismissCard(pairKey, async () => {
					showToast("success", "Transactions merged");
					await invalidateAll();
					isSubmitting = null;
				});
			} else {
				showToast("error", result.data?.error || "Failed to merge");
				isSubmitting = null;
			}
		} catch {
			showToast("error", "Failed to merge transactions");
			isSubmitting = null;
		}
	}

	async function handleDismiss(tx1Id: string, tx2Id: string) {
		const pairKey = `${tx1Id}:${tx2Id}`;
		if (isSubmitting) return;
		isSubmitting = pairKey;

		const formData = new FormData();
		formData.append("id1", tx1Id);
		formData.append("id2", tx2Id);

		try {
			const response = await fetch("?/dismiss", {
				method: "POST",
				body: formData,
				headers: { "x-sveltekit-action": "true" }
			});
			const result = await response.json();
			if (result.type === "success") {
				dismissCard(pairKey, async () => {
					await invalidateAll();
					isSubmitting = null;
				});
			} else {
				showToast("error", result.data?.error || "Failed to dismiss");
				isSubmitting = null;
			}
		} catch {
			showToast("error", "Failed to dismiss duplicate");
			isSubmitting = null;
		}
	}
</script>

<div class="merge-page">
	<header class="page-header">
		<div class="header-info">
			<h1>Merge Duplicates</h1>
			<span class="candidate-count">
				{data.candidates.length} potential duplicate{data.candidates.length !== 1 ? "s" : ""}
			</span>
		</div>
	</header>

	{#if data.candidates.length === 0}
		<div class="empty-state">
			<CheckCircle size={48} strokeWidth={1} />
			<h3>No duplicates found</h3>
			<p>No potential duplicate transfers detected.</p>
		</div>
	{:else}
		<div class="candidates-list">
			{#each data.candidates as candidate (candidate.tx1.id + ":" + candidate.tx2.id)}
				{@const pairKey = `${candidate.tx1.id}:${candidate.tx2.id}`}
				<div class="candidate-card" class:dismissing={dismissingPairs.has(pairKey)}>
					<div class="card-header">
						<div
							class="score-badge"
							style="background-color: {getScoreColor(candidate.score)}20; color: {getScoreColor(candidate.score)}"
						>
							{candidate.score}% match
						</div>
						<div class="reasons">
							{#each candidate.reasons as reason (reason)}
								<span class="reason-tag">{reason}</span>
							{/each}
						</div>
					</div>

					<div class="transactions-comparison">
						<div class="tx-card">
							<div class="tx-header">
								<span class="tx-date">{formatDate(candidate.tx1.date)}</span>
								<span class="tx-amount">{formatAmount(candidate.tx1.amount)}</span>
							</div>
							<div class="tx-desc">{candidate.tx1.description}</div>
							<div class="tx-accounts">
								{#if candidate.tx1.debitAccount}
									<div class="account-row">
										<span class="account-label">Debit:</span>
										<AccountTypeBadge type={candidate.tx1.debitAccount.type} />
										<span class="account-path">{candidate.tx1.debitAccount.path}</span>
									</div>
								{/if}
								{#if candidate.tx1.creditAccount}
									<div class="account-row">
										<span class="account-label">Credit:</span>
										<AccountTypeBadge type={candidate.tx1.creditAccount.type} />
										<span class="account-path">{candidate.tx1.creditAccount.path}</span>
									</div>
								{/if}
								{#if !candidate.tx1.debitAccount && !candidate.tx1.creditAccount}
									<div class="account-row no-account">No accounts assigned</div>
								{/if}
							</div>
							{#if candidate.tx1.importSource}
								<div class="tx-source">Source: {candidate.tx1.importSource}</div>
							{/if}
						</div>

						<div class="merge-arrow">
							<ArrowRight size={24} />
						</div>

						<div class="tx-card">
							<div class="tx-header">
								<span class="tx-date">{formatDate(candidate.tx2.date)}</span>
								<span class="tx-amount">{formatAmount(candidate.tx2.amount)}</span>
							</div>
							<div class="tx-desc">{candidate.tx2.description}</div>
							<div class="tx-accounts">
								{#if candidate.tx2.debitAccount}
									<div class="account-row">
										<span class="account-label">Debit:</span>
										<AccountTypeBadge type={candidate.tx2.debitAccount.type} />
										<span class="account-path">{candidate.tx2.debitAccount.path}</span>
									</div>
								{/if}
								{#if candidate.tx2.creditAccount}
									<div class="account-row">
										<span class="account-label">Credit:</span>
										<AccountTypeBadge type={candidate.tx2.creditAccount.type} />
										<span class="account-path">{candidate.tx2.creditAccount.path}</span>
									</div>
								{/if}
								{#if !candidate.tx2.debitAccount && !candidate.tx2.creditAccount}
									<div class="account-row no-account">No accounts assigned</div>
								{/if}
							</div>
							{#if candidate.tx2.importSource}
								<div class="tx-source">Source: {candidate.tx2.importSource}</div>
							{/if}
						</div>
					</div>

					<div class="card-actions">
						<Button
							variant="ghost"
							onclick={() => handleDismiss(candidate.tx1.id, candidate.tx2.id)}
							disabled={!!isSubmitting}
						>
							<Ban size={16} />
							Not a Dupe
						</Button>
						<Button
							variant="primary"
							onclick={() => handleMerge(candidate.tx1.id, candidate.tx2.id)}
							disabled={!!isSubmitting}
						>
							<GitMerge size={16} />
							{isSubmitting === pairKey ? "Merging..." : "Merge"}
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page-header {
		margin-bottom: var(--spacing-lg);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
	}

	.header-info {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-sm);
	}

	.candidate-count {
		color: var(--color-text-muted);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-success);
	}

	.empty-state h3 {
		margin: var(--spacing-md) 0 var(--spacing-xs);
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}

	.candidates-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.candidate-card {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		transition: all 0.3s ease-out;
		transform-origin: top center;
	}

	.candidate-card.dismissing {
		opacity: 0;
		transform: scaleY(0);
		margin-bottom: calc(-1 * var(--spacing-md));
		padding-top: 0;
		padding-bottom: 0;
		overflow: hidden;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
		flex-wrap: wrap;
	}

	.score-badge {
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		font-weight: 600;
	}

	.reasons {
		display: flex;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.reason-tag {
		padding: 2px 8px;
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.transactions-comparison {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: var(--spacing-md);
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.tx-card {
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.tx-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.tx-date {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.tx-amount {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.tx-desc {
		font-size: 14px;
		margin-bottom: var(--spacing-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tx-accounts {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		font-size: 13px;
	}

	.account-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.account-label {
		color: var(--color-text-muted);
		width: 50px;
	}

	.account-path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.account-row.no-account {
		color: var(--color-text-light);
		font-style: italic;
	}

	.tx-source {
		margin-top: var(--spacing-xs);
		font-size: 11px;
		color: var(--color-text-light);
	}

	.merge-arrow {
		color: var(--color-text-light);
	}

	.card-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border-light);
	}

	@media (max-width: 640px) {
		.transactions-comparison {
			grid-template-columns: 1fr;
		}

		.merge-arrow {
			transform: rotate(90deg);
			justify-self: center;
		}
	}
</style>
