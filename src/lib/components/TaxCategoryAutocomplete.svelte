<script lang="ts">
	import { Settings } from "lucide-svelte";
	import Dropdown from "$lib/components/ui/Dropdown.svelte";
	import { settingsStore } from "$lib/stores/settings";

	interface TaxCategory {
		id: string;
		name: string;
		scheduleRef: string | null;
	}

	let {
		value = $bindable(""),
		taxCategories,
		size = "md",
		placeholder = "None",
		maxWidth,
		dropdownMinWidth = "260px",
		onchange
	}: {
		value: string;
		taxCategories: TaxCategory[];
		size?: "sm" | "md";
		placeholder?: string;
		maxWidth?: string;
		dropdownMinWidth?: string;
		onchange?: (value: string) => void;
	} = $props();

	function openTaxModulesSettings() {
		settingsStore.open("tax-modules");
	}

	// Group tax categories by schedule type for better organization
	function getScheduleGroup(scheduleRef: string | null): string {
		if (!scheduleRef || scheduleRef === "N/A") return "Other";
		// Extract the schedule/form name from the ref
		const match = scheduleRef.match(/^(Schedule [A-Z]{1,2}|Form \d+|[A-Z]{2}-?\d+|CA \d+|NYC-\d+)/i);
		if (match) {
			const schedule = match[1];
			// Add friendly descriptions for common schedules
			if (/schedule c/i.test(schedule)) return "Schedule C (Business)";
			if (/schedule a/i.test(schedule)) return "Schedule A (Itemized)";
			if (/schedule b/i.test(schedule)) return "Schedule B (Interest/Dividends)";
			if (/schedule d/i.test(schedule)) return "Schedule D (Capital Gains)";
			if (/schedule e/i.test(schedule)) return "Schedule E (Rental/Royalty)";
			if (/schedule se/i.test(schedule)) return "Schedule SE (Self-Employment)";
			if (/schedule 1/i.test(schedule)) return "Schedule 1 (Adjustments)";
			if (/form 1120/i.test(schedule)) return "Form 1120 (C Corp)";
			if (/form 1040/i.test(schedule)) return "Form 1040";
			if (/it-201/i.test(schedule)) return "NY IT-201";
			if (/nj-1040/i.test(schedule)) return "NJ-1040";
			if (/ca 540/i.test(schedule)) return "CA 540";
			if (/nyc-/i.test(schedule)) return "NYC";
			return schedule;
		}
		return "Other";
	}

	const options = $derived.by(() => {
		// Find "Not Deductible" to put it at the top
		const notDeductible = taxCategories.find((tc) => tc.name === "Not Deductible");
		const otherCategories = taxCategories
			.filter((tc) => tc.name !== "Not Deductible")
			.map((tc) => ({
				value: tc.id,
				label: tc.name,
				description: tc.scheduleRef || undefined,
				group: getScheduleGroup(tc.scheduleRef)
			}))
			.sort((a, b) => {
				// Sort by group, then by label
				if (a.group !== b.group) return a.group.localeCompare(b.group);
				return a.label.localeCompare(b.label);
			});

		const result: { value: string; label: string; description?: string; group?: string }[] = [
			{ value: "", label: "None" }
		];

		if (notDeductible) {
			result.push({
				value: notDeductible.id,
				label: notDeductible.name,
				description: notDeductible.scheduleRef || undefined
			});
		}

		result.push(...otherCategories);
		return result;
	});
</script>

<Dropdown
	{options}
	{size}
	bind:value
	{placeholder}
	{maxWidth}
	{dropdownMinWidth}
	searchable
	searchPlaceholder="Search tax categories..."
	{onchange}
>
	{#snippet footer()}
		<button class="manage-link" onclick={openTaxModulesSettings}>
			<Settings size={14} />
			Manage Tax Categories
		</button>
	{/snippet}
</Dropdown>

<style>
	.manage-link {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}

	.manage-link:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}
</style>
