<script lang="ts">
	import { DollarSign, X } from "lucide-svelte";

	interface Props {
		min: string;
		max: string;
		onchange?: (min: string, max: string) => void;
	}

	let { min = $bindable(), max = $bindable(), onchange }: Props = $props();

	let minInput = $state(min);
	let maxInput = $state(max);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Sync with external changes
	$effect(() => {
		minInput = min;
		maxInput = max;
	});

	function debouncedUpdate() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			min = minInput;
			max = maxInput;
			onchange?.(min, max);
		}, 300);
	}

	function handleMinInput() {
		debouncedUpdate();
	}

	function handleMaxInput() {
		debouncedUpdate();
	}

	function clearAmount() {
		minInput = "";
		maxInput = "";
		min = "";
		max = "";
		onchange?.("", "");
	}

	const hasValue = $derived(minInput || maxInput);
</script>

<div class="amount-input">
	<DollarSign size={16} />
	<input type="number" step="0.01" min="0" placeholder="Min" bind:value={minInput} oninput={handleMinInput} />
	<span class="separator">–</span>
	<input type="number" step="0.01" min="0" placeholder="Max" bind:value={maxInput} oninput={handleMaxInput} />
	{#if hasValue}
		<button type="button" class="clear-btn" onclick={clearAmount} aria-label="Clear amount filter">
			<X size={16} />
		</button>
	{/if}
</div>

<style>
	.amount-input {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.amount-input > :global(svg:first-child) {
		position: absolute;
		left: var(--spacing-sm);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	input[type="number"] {
		width: 70px;
		padding: 0 var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: 14px;
		height: 36px;
	}

	input[type="number"]:first-of-type {
		padding-left: 28px;
		width: 90px;
	}

	input[type="number"]:focus {
		border-color: var(--color-primary);
		outline: none;
		box-shadow: 0 0 0 3px var(--color-primary-light);
	}

	/* Hide number input spinners */
	input[type="number"]::-webkit-inner-spin-button,
	input[type="number"]::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	input[type="number"] {
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.separator {
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.clear-btn {
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

	.clear-btn:hover {
		color: var(--color-text);
		background: var(--color-bg-alt);
	}
</style>
