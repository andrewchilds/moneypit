<script lang="ts">
	import Dropdown from '$lib/components/ui/Dropdown.svelte';
	import { formatLocalDate } from '$lib/utils/date';

	interface Props {
		from: string;
		to: string;
		onchange?: (from: string, to: string) => void;
	}

	let { from = $bindable(), to = $bindable(), onchange }: Props = $props();

	const currentYear = new Date().getFullYear();
	const lastYear = currentYear - 1;

	type PresetKey = 'all' | 'this-month' | 'last-month' | 'ytd' | 'last-year' | 'last-18-months' | 'custom';

	function getPresetDates(preset: PresetKey): { from: string; to: string } {
		const today = new Date();
		const year = today.getFullYear();
		const month = today.getMonth();

		switch (preset) {
			case 'this-month': {
				const start = new Date(year, month, 1);
				return {
					from: formatLocalDate(start),
					to: formatLocalDate(today)
				};
			}
			case 'last-month': {
				const start = new Date(year, month - 1, 1);
				const end = new Date(year, month, 0);
				return {
					from: formatLocalDate(start),
					to: formatLocalDate(end)
				};
			}
			case 'ytd': {
				const start = new Date(year, 0, 1);
				return {
					from: formatLocalDate(start),
					to: formatLocalDate(today)
				};
			}
			case 'last-year': {
				const start = new Date(lastYear, 0, 1);
				const end = new Date(lastYear, 11, 31);
				return {
					from: formatLocalDate(start),
					to: formatLocalDate(end)
				};
			}
			case 'last-18-months': {
				const start = new Date(today);
				start.setMonth(start.getMonth() - 18);
				start.setDate(1);
				return {
					from: formatLocalDate(start),
					to: formatLocalDate(today)
				};
			}
			case 'all':
			default:
				return { from: '', to: '' };
		}
	}

	function detectCurrentPreset(): PresetKey {
		if (!from && !to) return 'all';

		const presets: PresetKey[] = ['this-month', 'last-month', 'ytd', 'last-year', 'last-18-months'];
		for (const preset of presets) {
			const dates = getPresetDates(preset);
			if (dates.from === from && dates.to === to) {
				return preset;
			}
		}
		return 'custom';
	}

	let selectedPreset = $state<PresetKey>(detectCurrentPreset());

	const presetOptions = [
		{ value: 'all', label: 'All Time' },
		{ value: 'this-month', label: 'This Month' },
		{ value: 'last-month', label: 'Last Month' },
		{ value: 'ytd', label: 'Year to Date' },
		{ value: 'last-year', label: `${lastYear}` },
		{ value: 'last-18-months', label: 'Last 18 Months' },
		{ value: 'custom', label: 'Custom Range' }
	];

	function handlePresetChange(preset: string) {
		selectedPreset = preset as PresetKey;
		if (preset !== 'custom') {
			const dates = getPresetDates(preset as PresetKey);
			from = dates.from;
			to = dates.to;
			onchange?.(from, to);
		}
	}

	function handleFromChange(e: Event) {
		const input = e.target as HTMLInputElement;
		from = input.value;
		selectedPreset = 'custom';
		onchange?.(from, to);
	}

	function handleToChange(e: Event) {
		const input = e.target as HTMLInputElement;
		to = input.value;
		selectedPreset = 'custom';
		onchange?.(from, to);
	}
</script>

<div class="date-range-picker">
	<Dropdown options={presetOptions} value={selectedPreset} onchange={handlePresetChange} clearable={true} defaultValue="all" />
	{#if selectedPreset === 'custom'}
		<div class="custom-inputs">
			<label>
				<span class="sr-only">From date</span>
				<input type="date" value={from} onchange={handleFromChange} />
			</label>
			<span class="separator">to</span>
			<label>
				<span class="sr-only">To date</span>
				<input type="date" value={to} onchange={handleToChange} />
			</label>
		</div>
	{/if}
</div>

<style>
	.date-range-picker {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.custom-inputs {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	input[type='date'] {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: 13px;
	}

	input[type='date']:focus {
		border-color: var(--color-primary);
		outline: none;
		box-shadow: 0 0 0 3px var(--color-primary-light);
	}

	.separator {
		color: var(--color-text-muted);
		font-size: 13px;
	}
</style>
