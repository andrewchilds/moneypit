<script lang="ts">
	import Autocomplete from "./ui/Autocomplete.svelte";

	type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

	interface Account {
		id: string;
		type: AccountType;
		path: string;
		last4?: string | null;
	}

	interface Props {
		accounts: Account[];
		value: string;
		placeholder?: string;
		filterType?: AccountType;
		defaultCreateType?: AccountType;
		disabled?: boolean;
		autofocus?: boolean;
		onselect?: (account: Account) => void;
		onclickoutside?: () => void;
	}

	let {
		accounts,
		value = $bindable(),
		placeholder = "Search or create account...",
		filterType,
		defaultCreateType = "EXPENSE",
		disabled = false,
		autofocus = false,
		onselect,
		onclickoutside
	}: Props = $props();

	let creating = $state(false);

	const filteredAccounts = $derived(filterType ? accounts.filter((a) => a.type === filterType) : accounts);

	const options = $derived(
		filteredAccounts.map((a) => ({
			value: a.id,
			label: a.path,
			sublabel: a.last4 || undefined,
			meta: a.type
		}))
	);

	async function handleChange(val: string, isNew: boolean) {
		if (isNew) {
			// Create the account
			creating = true;
			try {
				const response = await fetch("/api/accounts", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: defaultCreateType, path: val })
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.message || "Failed to create account");
				}

				const newAccount: Account = await response.json();
				value = newAccount.id;
				onselect?.(newAccount);
			} catch (e) {
				console.error("Failed to create account:", e);
			} finally {
				creating = false;
			}
		} else {
			value = val;
			const account = accounts.find((a) => a.id === val);
			if (account) {
				onselect?.(account);
			}
		}
	}
</script>

<div class="account-autocomplete">
	<Autocomplete
		{options}
		bind:value
		{placeholder}
		disabled={disabled || creating}
		{autofocus}
		allowCreate
		createPrefix="Create"
		minDropdownWidth="300px"
		onchange={handleChange}
		{onclickoutside}
	/>
	{#if creating}
		<span class="creating-indicator">Creating...</span>
	{/if}
</div>

<style>
	.account-autocomplete {
		position: relative;
		width: 100%;
	}

	.creating-indicator {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 12px;
		color: var(--color-text-muted);
	}
</style>
