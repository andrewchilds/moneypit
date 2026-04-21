<script lang="ts">
	import "../app.css";
	import favicon from "$lib/assets/favicon.svg";
	import AgentPanel from "$lib/components/AgentPanel.svelte";
	import BookSelector from "$lib/components/BookSelector.svelte";
	import SettingsModal from "$lib/components/SettingsModal.svelte";
	import Toast from "$lib/components/ui/Toast.svelte";
	import { sessionStore } from "$lib/stores/sessions";
	import { settingsStore } from "$lib/stores/settings";
	import {
		LayoutDashboard,
		Wallet,
		ArrowLeftRight,
		Upload,
		ListChecks,
		GitMerge,
		FileText,
		History,
		PanelLeftClose,
		PanelLeftOpen,
		Shovel,
		Settings
	} from "lucide-svelte";
	import { page } from "$app/state";
	import { browser } from "$app/environment";

	let { children, data } = $props();

	// Sync settings modal state with store
	$effect(() => {
		if ($settingsStore.open) {
			settingsOpen = true;
			if ($settingsStore.initialTab) {
				settingsInitialTab = $settingsStore.initialTab;
			}
		}
	});

	let settingsOpen = $state(false);
	let settingsInitialTab = $state<string | undefined>(undefined);
	const books = $derived(data.books);

	// Persist collapsed states
	let navCollapsed = $state(false);
	let claudeCollapsedLocal = $state(true);

	// Derive claude panel state from store OR local state
	// Store's panelOpen takes precedence when true (to allow programmatic opening)
	let claudeCollapsed = $derived(!$sessionStore.panelOpen && claudeCollapsedLocal);

	// Load from localStorage on mount
	$effect(() => {
		if (browser) {
			navCollapsed = localStorage.getItem("navCollapsed") === "true";
			claudeCollapsedLocal = localStorage.getItem("claudeCollapsed") !== "false";
		}
	});

	// Save to localStorage on change
	function toggleNav() {
		navCollapsed = !navCollapsed;
		if (browser) localStorage.setItem("navCollapsed", String(navCollapsed));
	}

	function toggleClaude() {
		const newCollapsed = !claudeCollapsed;
		claudeCollapsedLocal = newCollapsed;
		sessionStore.setPanelOpen(!newCollapsed);
		if (browser) localStorage.setItem("claudeCollapsed", String(newCollapsed));
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		// Don't trigger when typing in inputs
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		if (e.key === "[") {
			e.preventDefault();
			toggleNav();
		} else if (e.key === "]") {
			e.preventDefault();
			toggleClaude();
		}
	}

	const navItems = [
		{ href: "/", icon: LayoutDashboard, label: "Dashboard" },
		{ href: "/accounts", icon: Wallet, label: "Accounts" },
		{ href: "/transactions", icon: ArrowLeftRight, label: "Transactions" },
		{ href: "/categorize", icon: ListChecks, label: "Categorize" },
		{ href: "/merge", icon: GitMerge, label: "Merge" },
		{ href: "/import", icon: Upload, label: "Import" },
		{ href: "/reports", icon: FileText, label: "Reports" },
		{ href: "/activity", icon: History, label: "Activity" },
		{
			href: "#settings",
			icon: Settings,
			label: "Settings",
			action: () => {
				settingsOpen = true;
			}
		}
	];

	function handleNavClick(e: MouseEvent, item: (typeof navItems)[0]) {
		if (item.action) {
			e.preventDefault();
			item.action();
		}
	}

	function isActive(href: string): boolean {
		if (href === "/") return page.url.pathname === "/";
		return page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Moneypit</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="app-shell">
	<nav class="sidebar" class:collapsed={navCollapsed}>
		<div class="sidebar-header">
			{#if !navCollapsed}
				<span class="logo">Moneypit <Shovel size={18} /></span>
			{/if}
			<button
				class="toggle-btn"
				onclick={toggleNav}
				aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
			>
				{#if navCollapsed}
					<PanelLeftOpen size={18} />
				{:else}
					<PanelLeftClose size={18} />
				{/if}
			</button>
		</div>

		<div class="book-selector-wrapper" class:collapsed={navCollapsed}>
			<BookSelector
				{books}
				currentBookId={data.bookId}
				collapsed={navCollapsed}
				onmanage={() => {
					settingsOpen = true;
				}}
			/>
		</div>

		<ul class="nav-list">
			{#each navItems as item (item.href)}
				{@const Icon = item.icon}
				<li>
					<a
						href={item.href}
						class="nav-item"
						class:active={isActive(item.href)}
						title={navCollapsed ? item.label : undefined}
						onclick={(e) => handleNavClick(e, item)}
					>
						<Icon size={18} />
						{#if !navCollapsed}
							<span>{item.label}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main class="main-content">
		{@render children()}
	</main>

	<AgentPanel collapsed={claudeCollapsed} ontoggle={toggleClaude} bookId={data.bookId} />
</div>

<SettingsModal
	bind:open={settingsOpen}
	{books}
	currentBookId={data.bookId}
	initialTab={settingsInitialTab}
	onclose={() => {
		settingsOpen = false;
		settingsInitialTab = undefined;
		settingsStore.close();
	}}
/>

<Toast />

<style>
	.app-shell {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		width: var(--sidebar-width);
		background: var(--color-bg-alt);
		border-right: 1px solid var(--color-border);
		transition: width var(--transition-normal);
	}

	.sidebar.collapsed {
		width: var(--sidebar-collapsed-width);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--header-height);
		padding: 0 var(--spacing-sm);
		border-bottom: 1px solid var(--color-border-light);
	}

	.logo {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-weight: 700;
		font-size: 16px;
		color: var(--color-primary);
		padding-left: var(--spacing-sm);
	}

	.logo :global(svg) {
		opacity: 0.6;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.toggle-btn:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}

	.nav-list {
		list-style: none;
		margin: 0;
		padding: var(--spacing-sm);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-sm);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		text-decoration: none;
		transition: all var(--transition-fast);
	}

	.nav-item:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
		text-decoration: none;
	}

	.nav-item.active {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.sidebar.collapsed .nav-item {
		justify-content: center;
		padding: var(--spacing-sm);
	}

	.main-content {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-lg);
	}

	.book-selector-wrapper {
		padding: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border-light);
	}

	.book-selector-wrapper.collapsed {
		padding: var(--spacing-xs);
	}
</style>
