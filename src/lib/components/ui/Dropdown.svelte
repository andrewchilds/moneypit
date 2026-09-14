<script lang="ts">
	import type { Snippet } from "svelte";
	import { ChevronDown, Search, X } from "lucide-svelte";
	import { portal } from "$lib/actions/portal";
	import { scale } from "svelte/transition";

	interface Option {
		value: string;
		label: string;
		description?: string;
		disabled?: boolean;
		group?: string;
	}

	interface Props {
		options: Option[];
		value: string;
		placeholder?: string;
		disabled?: boolean;
		minWidth?: string;
		maxWidth?: string;
		dropdownMinWidth?: string;
		searchable?: boolean;
		searchPlaceholder?: string;
		clearable?: boolean;
		defaultValue?: string;
		onchange?: (value: string) => void;
		trigger?: Snippet;
		footer?: Snippet;
		size?: "sm" | "md";
	}

	let {
		options,
		size = "md",
		value = $bindable(),
		placeholder = "Select...",
		disabled = false,
		minWidth = "120px",
		maxWidth,
		dropdownMinWidth = "200px",
		searchable = false,
		searchPlaceholder = "Filter...",
		clearable = false,
		defaultValue = "",
		onchange,
		trigger,
		footer
	}: Props = $props();

	const isActive = $derived(clearable && value !== defaultValue);

	let open = $state(false);
	let searchQuery = $state("");
	let containerRef: HTMLDivElement;
	let searchInputRef: HTMLInputElement | undefined = $state();
	let dropdownStyle = $state("");
	let positionAbove = $state(false);

	const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? placeholder);

	// Filter options based on search query
	const filteredOptions = $derived(
		searchQuery ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase())) : options
	);

	// Group filtered options
	const groupedOptions = $derived(() => {
		const groups = new Map<string | undefined, Option[]>();
		for (const option of filteredOptions) {
			const group = option.group;
			if (!groups.has(group)) {
				groups.set(group, []);
			}
			groups.get(group)!.push(option);
		}
		return groups;
	});

	function updateDropdownPosition() {
		if (!containerRef) return;
		const rect = containerRef.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		const spaceBelow = viewportHeight - rect.bottom;
		const spaceAbove = rect.top;
		const estimatedMenuHeight = 350; // max-height of dropdown-menu

		// Position above if not enough space below and more space above
		positionAbove = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

		if (positionAbove) {
			dropdownStyle = `
				position: fixed;
				bottom: ${viewportHeight - rect.top + 4}px;
				left: ${rect.left}px;
				min-width: ${dropdownMinWidth};
			`;
		} else {
			dropdownStyle = `
				position: fixed;
				top: ${rect.bottom + 4}px;
				left: ${rect.left}px;
				min-width: ${dropdownMinWidth};
			`;
		}
	}

	function toggle() {
		if (!disabled) {
			open = !open;
			if (open) {
				updateDropdownPosition();
				searchQuery = "";
				// Focus search input when opening
				setTimeout(() => searchInputRef?.focus(), 0);
			}
		}
	}

	function select(option: Option) {
		if (option.disabled) return;
		value = option.value;
		open = false;
		searchQuery = "";
		onchange?.(option.value);
	}

	function clear(e: MouseEvent) {
		e.stopPropagation();
		value = defaultValue;
		onchange?.(defaultValue);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			open = false;
			searchQuery = "";
		} else if (e.key === "Enter" || e.key === " ") {
			if (!open) {
				e.preventDefault();
				toggle();
			}
		} else if (e.key === "ArrowDown" && open) {
			e.preventDefault();
			const idx = filteredOptions.findIndex((o) => o.value === value);
			const next = filteredOptions.slice(idx + 1).find((o) => !o.disabled);
			if (next) select(next);
		} else if (e.key === "ArrowUp" && open) {
			e.preventDefault();
			const idx = filteredOptions.findIndex((o) => o.value === value);
			const prev = filteredOptions
				.slice(0, idx)
				.reverse()
				.find((o) => !o.disabled);
			if (prev) select(prev);
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			open = false;
			searchQuery = "";
		} else if (e.key === "Enter") {
			// Select first non-disabled option
			const first = filteredOptions.find((o) => !o.disabled);
			if (first) select(first);
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			const first = filteredOptions.find((o) => !o.disabled);
			if (first) select(first);
		}
	}

	// Center the selected option in the list when the menu opens. Scrolls the
	// list element directly rather than scrollIntoView so the page never moves.
	// The action runs before the menu is in the document, so it waits a frame
	// for layout.
	function revealSelected(node: HTMLElement, selected: boolean) {
		if (!selected) return;
		requestAnimationFrame(() => {
			const list = node.parentElement;
			if (!list) return;
			const top = node.offsetTop - list.offsetTop;
			list.scrollTop = top - (list.clientHeight - node.offsetHeight) / 2;
		});
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerRef && !containerRef.contains(e.target as Node)) {
			open = false;
			searchQuery = "";
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="dropdown" bind:this={containerRef} style:min-width={minWidth} style:max-width={maxWidth}>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="dropdown-trigger size-{size}"
		class:disabled
		class:active={isActive}
		role="combobox"
		tabindex="0"
		aria-expanded={open}
		aria-controls="dropdown-listbox"
		aria-haspopup="listbox"
		onkeydown={handleKeydown}
		onclick={toggle}
	>
		{#if trigger}
			{@render trigger()}
		{:else}
			<span class="dropdown-value" class:placeholder={!value}>{selectedLabel}</span>
			{#if isActive}
				<button type="button" class="dropdown-clear" onclick={clear} aria-label="Clear filter">
					<X size={14} />
				</button>
			{:else}
				<ChevronDown size={16} class="dropdown-icon" />
			{/if}
		{/if}
	</div>

	{#if open}
		<div
			class="dropdown-menu"
			class:above={positionAbove}
			role="listbox"
			id="dropdown-listbox"
			style={dropdownStyle}
			use:portal={"body"}
			transition:scale|global={{ duration: 150, start: 0.95 }}
		>
			{#if searchable}
				<div class="dropdown-search">
					<Search size={14} />
					<input
						bind:this={searchInputRef}
						type="text"
						bind:value={searchQuery}
						placeholder={searchPlaceholder}
						onkeydown={handleSearchKeydown}
						onclick={(e) => e.stopPropagation()}
					/>
				</div>
			{/if}
			<ul class="dropdown-options">
				{#each groupedOptions() as [group, groupOptions] (group ?? "__ungrouped__")}
					{#if group}
						<li class="dropdown-group-header">{group}</li>
					{/if}
					{#each groupOptions as option (option.value)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<li
							class="dropdown-option"
							class:selected={option.value === value}
							class:disabled={option.disabled}
							class:grouped={!!group}
							class:has-description={!!option.description}
							role="option"
							aria-selected={option.value === value}
							use:revealSelected={option.value === value}
							onclick={() => select(option)}
						>
							<span class="option-label">{option.label}</span>
							{#if option.description}
								<span class="option-description">{option.description}</span>
							{/if}
						</li>
					{/each}
				{/each}
				{#if filteredOptions.length === 0}
					<li class="dropdown-empty">No matches</li>
				{/if}
			</ul>
			{#if footer}
				<div class="dropdown-footer">
					{@render footer()}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
		display: inline-block;
	}

	.dropdown-trigger {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		width: 100%;
	}

	.dropdown-trigger.size-md {
		height: 36px;
	}

	.dropdown-trigger.size-sm {
		height: 24px;
	}

	.dropdown-trigger:hover:not(.disabled) {
		border-color: var(--color-text-muted);
	}

	.dropdown-trigger.disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.dropdown-trigger.active {
		background: var(--color-primary-light);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.dropdown-trigger.active:hover:not(.disabled) {
		border-color: var(--color-primary);
	}

	.dropdown-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
	}

	.dropdown-clear:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.1);
	}

	.dropdown-value {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dropdown-value.placeholder {
		color: var(--color-text-muted);
	}

	.dropdown-menu {
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		z-index: 9999;
		max-height: 350px;
		transform-origin: top center;
		min-width: 180px;
	}

	.dropdown-menu.above {
		transform-origin: bottom center;
	}

	.dropdown-search {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}

	.dropdown-search input {
		flex: 1;
		border: none;
		background: transparent;
		outline: none;
		font-size: inherit;
		padding: 0;
	}

	.dropdown-search input:focus {
		box-shadow: none;
	}

	.dropdown-options {
		margin: 0;
		padding: var(--spacing-xs) 0;
		list-style: none;
		overflow-y: auto;
		flex: 1;
	}

	.dropdown-group-header {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		background: var(--color-bg-alt);
	}

	.dropdown-option {
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}

	.dropdown-option.grouped {
		padding-left: var(--spacing-lg);
	}

	.dropdown-option:hover:not(.disabled) {
		background: var(--color-bg-alt);
	}

	.dropdown-option.selected {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.dropdown-option.disabled {
		color: var(--color-text-light);
		cursor: not-allowed;
	}

	.dropdown-option.has-description {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.option-label {
		line-height: 1.3;
	}

	.option-description {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.2;
	}

	.dropdown-option.selected .option-description {
		color: var(--color-primary);
		opacity: 0.8;
	}

	.dropdown-empty {
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.dropdown-footer {
		border-top: 1px solid var(--color-border-light);
		padding: var(--spacing-xs) var(--spacing-sm);
	}
</style>
