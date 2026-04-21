<script lang="ts">
	import { Search } from 'lucide-svelte';
	import { portal } from '$lib/actions/portal';
	import { scale } from 'svelte/transition';

	interface Option {
		value: string;
		label: string;
		sublabel?: string;
		meta?: string;
	}

	interface Props {
		options: Option[];
		value: string;
		placeholder?: string;
		disabled?: boolean;
		autofocus?: boolean;
		allowCreate?: boolean;
		createPrefix?: string;
		minDropdownWidth?: string;
		size?: 'sm' | 'md';
		onchange?: (value: string, isNew: boolean) => void;
		onclickoutside?: () => void;
	}

	let {
		options,
		value = $bindable(),
		placeholder = 'Search...',
		disabled = false,
		allowCreate = false,
		autofocus = false,
		createPrefix = 'Create:',
		minDropdownWidth,
		size = 'md',
		onchange,
		onclickoutside
	}: Props = $props();

	let query = $state('');
	let open = $state(false);
	let highlightIndex = $state(0);
	let inputRef: HTMLInputElement;
	let containerRef: HTMLDivElement;
	let dropdownRef = $state<HTMLUListElement>();
	let dropdownStyle = $state('');

	const filteredOptions = $derived.by(() => {
		if (!query) return options;
		const q = query.toLowerCase();
		return options.filter((o) => o.label.toLowerCase().includes(q) || o.meta?.toLowerCase().includes(q));
	});

	const showCreateOption = $derived(allowCreate && query && !filteredOptions.some((o) => o.label.toLowerCase() === query.toLowerCase()));

	const selectedOption = $derived(options.find((o) => o.value === value));

	$effect(() => {
		if (!open) {
			query = selectedOption?.label ?? '';
		}
	});

	$effect(() => {
		if (autofocus && inputRef) {
			inputRef.focus();
		}
	});

	function updateDropdownPosition() {
		if (!containerRef) return;
		const rect = containerRef.getBoundingClientRect();
		const width = minDropdownWidth ? `max(${rect.width}px, ${minDropdownWidth})` : `${rect.width}px`;
		dropdownStyle = `
			position: fixed;
			top: ${rect.bottom + 4}px;
			left: ${rect.left}px;
			width: ${width};
		`;
	}

	function handleFocus() {
		open = true;
		query = '';
		highlightIndex = 0;
		updateDropdownPosition();
	}

	function handleBlur() {
		// Delay to allow click on option
		setTimeout(() => {
			open = false;
			if (selectedOption) {
				query = selectedOption.label;
			} else {
				query = '';
			}
		}, 150);
	}

	function selectOption(option: Option, isNew = false) {
		value = option.value;
		query = option.label;
		open = false;
		onchange?.(option.value, isNew);
	}

	function createOption() {
		const newValue = query.trim();
		selectOption({ value: newValue, label: newValue }, true);
	}

	function handleKeydown(e: KeyboardEvent) {
		const totalOptions = filteredOptions.length + (showCreateOption ? 1 : 0);

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightIndex = Math.min(highlightIndex + 1, totalOptions - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightIndex = Math.max(highlightIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (highlightIndex < filteredOptions.length) {
				selectOption(filteredOptions[highlightIndex]);
			} else if (showCreateOption) {
				createOption();
			}
		} else if (e.key === 'Escape') {
			open = false;
			inputRef?.blur();
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		const inContainer = containerRef?.contains(target);
		const inDropdown = dropdownRef?.contains(target);
		if (!inContainer && !inDropdown) {
			open = false;
			onclickoutside?.();
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="autocomplete" bind:this={containerRef}>
	<div class="input-wrapper size-{size}">
		<Search size={16} class="search-icon" />
		<input
			bind:this={inputRef}
			type="text"
			bind:value={query}
			{placeholder}
			{disabled}
			onfocus={handleFocus}
			onblur={handleBlur}
			onkeydown={handleKeydown}
			role="combobox"
			aria-expanded={open}
			aria-controls="autocomplete-listbox"
			aria-autocomplete="list"
		/>
	</div>

	{#if open && (filteredOptions.length > 0 || showCreateOption)}
		<ul bind:this={dropdownRef} class="options-list" role="listbox" id="autocomplete-listbox" style={dropdownStyle} use:portal={'body'} transition:scale|global={{ duration: 150, start: 0.95 }}>
			{#each filteredOptions as option, i (option.value)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					class="option"
					class:highlighted={i === highlightIndex}
					class:selected={option.value === value}
					role="option"
					aria-selected={option.value === value}
					onmousedown={() => selectOption(option)}
					onmouseenter={() => (highlightIndex = i)}
				>
					<span class="option-label">
						{option.label}
						{#if option.sublabel}
							<span class="option-sublabel">{option.sublabel}</span>
						{/if}
					</span>
					{#if option.meta}
						<span class="option-meta">{option.meta}</span>
					{/if}
				</li>
			{/each}
			{#if showCreateOption}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					class="option create-option"
					class:highlighted={highlightIndex === filteredOptions.length}
					role="option"
					aria-selected={false}
					onmousedown={createOption}
					onmouseenter={() => (highlightIndex = filteredOptions.length)}
				>
					<span class="create-label">{createPrefix} {query}</span>
				</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.autocomplete {
		position: relative;
		width: 100%;
	}

	.input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.input-wrapper :global(.search-icon) {
		position: absolute;
		left: var(--spacing-sm);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.input-wrapper input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) 36px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
	}

	.input-wrapper.size-md {
		height: 36px;
	}

	.input-wrapper.size-md input {
		height: 36px;
	}

	.input-wrapper.size-sm {
		height: 24px;
	}

	.input-wrapper.size-sm input {
		height: 24px;
		padding: 0 var(--spacing-xs) 0 28px;
		font-size: 13px;
	}

	.input-wrapper.size-sm :global(.search-icon) {
		left: var(--spacing-xs);
		width: 14px;
		height: 14px;
	}

	.input-wrapper input:focus {
		border-color: var(--color-primary);
		outline: none;
		box-shadow: 0 0 0 3px var(--color-primary-light);
	}

	.input-wrapper input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.options-list {
		margin: 0;
		padding: var(--spacing-xs) 0;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		list-style: none;
		z-index: 9999;
		max-height: 250px;
		overflow-y: auto;
		overflow-x: hidden;
		transform-origin: top;
	}

	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}

	.option:hover,
	.option.highlighted {
		background: var(--color-bg-alt);
	}

	.option.selected {
		background: var(--color-primary-light);
	}

	.option-label {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}

	.option-sublabel {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-left: var(--spacing-xs);
	}

	.option-meta {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.create-option {
		border-top: 1px solid var(--color-border-light);
		margin-top: var(--spacing-xs);
		padding-top: var(--spacing-sm);
	}

	.create-label {
		color: var(--color-primary);
		font-weight: 500;
	}
</style>
