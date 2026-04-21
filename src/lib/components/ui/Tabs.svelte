<script lang="ts">
	interface Tab {
		id: string;
		label: string;
		icon?: string;
	}

	interface Props {
		tabs: Tab[];
		value: string;
		onchange?: (id: string) => void;
	}

	let { tabs, value = $bindable(), onchange }: Props = $props();

	function selectTab(id: string) {
		value = id;
		onchange?.(id);
	}
</script>

<div class="tabs">
	{#each tabs as tab (tab.id)}
		<button
			class="tab"
			class:active={value === tab.id}
			onclick={() => selectTab(tab.id)}
		>
			{#if tab.icon}
				<span class="tab-icon">{tab.icon}</span>
			{/if}
			<span class="tab-label">{tab.label}</span>
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border-light);
		padding-bottom: var(--spacing-xs);
	}

	.tab {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 12px;
		transition: all 0.15s ease;
	}

	.tab:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.tab.active {
		background: var(--color-bg-alt);
		color: var(--color-text);
		font-weight: 500;
	}

	.tab-icon {
		font-size: 14px;
	}

	.tab-label {
		white-space: nowrap;
	}
</style>
