<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Circle, PanelRightClose, PanelRightOpen, Terminal as TerminalIcon, X, Plus, Settings } from 'lucide-svelte';
	import Button from './ui/Button.svelte';
	import Modal from './ui/Modal.svelte';
	import Terminal from './Terminal.svelte';
	import AgentSettings from './AgentSettings.svelte';
	import { sessionStore, type SessionInfo } from '$lib/stores/sessions';
	import { getAgent } from '$lib/agents/config';

	interface Props {
		collapsed: boolean;
		ontoggle: () => void;
		bookId: string;
	}

	let { collapsed = $bindable(), ontoggle, bookId }: Props = $props();

	// Resizing state
	let panelWidth = $state(600);
	let isResizing = $state(false);
	const MIN_WIDTH = 400;
	const MAX_WIDTH = 900;

	// Settings modal state
	let showSettings = $state(false);
	let selectedAgentId = $derived($sessionStore.selectedAgentId);

	// Load saved width from localStorage
	$effect(() => {
		if (browser) {
			// Check both old and new key names for backward compatibility
			const savedWidth = localStorage.getItem('agentPanelWidth') || localStorage.getItem('claudePanelWidth');
			if (savedWidth) {
				const parsed = parseInt(savedWidth, 10);
				if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
					panelWidth = parsed;
				}
			}
		}
	});

	function handleResizeStart(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		document.addEventListener('mousemove', handleResize);
		document.addEventListener('mouseup', handleResizeEnd);
	}

	function handleResize(e: MouseEvent) {
		if (!isResizing) return;
		const newWidth = window.innerWidth - e.clientX;
		panelWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
	}

	function handleResizeEnd() {
		isResizing = false;
		document.removeEventListener('mousemove', handleResize);
		document.removeEventListener('mouseup', handleResizeEnd);
		if (browser) {
			localStorage.setItem('agentPanelWidth', String(panelWidth));
		}
	}

	let sessions = $derived($sessionStore.sessions);
	let activeSessionId = $derived($sessionStore.activeSessionId);
	let connectionStatus = $derived($sessionStore.connectionStatus);

	const statusColors = {
		connecting: "var(--color-warning)",
		connected: "var(--color-success)",
		disconnected: "var(--color-danger)"
	};

	const taskTypeIcons: Record<string, string> = {
		audit: "🔍",
		suggest: "💡",
		general: "💬"
	};

	function getSessionIcon(session: SessionInfo): string {
		return taskTypeIcons[session.taskType] || "💬";
	}

	function handleTabClick(session: SessionInfo) {
		sessionStore.attachSession(session.id);
	}

	function handleCloseSession(e: Event, sessionId: string) {
		e.stopPropagation();
		sessionStore.killSession(sessionId);
	}

	function handleNewSession() {
		sessionStore.createSession({
			taskType: "general",
			title: "New Session",
			agentId: selectedAgentId,
			bookId
		});
	}

	function truncateTitle(title: string, maxLength = 20): string {
		if (title.length <= maxLength) return title;
		return title.slice(0, maxLength - 1) + "…";
	}

	const selectedAgent = $derived(getAgent(selectedAgentId));

	onMount(() => {
		sessionStore.loadSelectedAgent();
		sessionStore.connect();
	});
</script>

<aside
	class="agent-panel"
	class:collapsed
	class:resizing={isResizing}
	style:--dynamic-width="{panelWidth}px"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="resize-handle" onmousedown={handleResizeStart}></div>
	<div class="panel-header">
		{#if !collapsed}
			<div class="header-left">
				<TerminalIcon size={18} />
				<span class="title">Agent</span>
				<Circle
					size={8}
					fill={statusColors[connectionStatus]}
					color={statusColors[connectionStatus]}
					aria-label={connectionStatus}
				/>
			</div>
			<div class="header-actions">
				<button class="icon-btn" onclick={() => showSettings = true} title="Agent Settings">
					<Settings size={16} />
				</button>
				<Button variant="ghost" size="sm" onclick={ontoggle}>
					<PanelRightClose size={16} />
				</Button>
			</div>
		{:else}
			<Button variant="ghost" size="sm" onclick={ontoggle}>
				<PanelRightOpen size={16} />
			</Button>
		{/if}
	</div>

	{#if !collapsed}
		<div class="session-tabs">
			{#each sessions as session (session.id)}
				<div
					class="session-tab"
					class:active={session.id === activeSessionId}
					onclick={() => handleTabClick(session)}
					onkeydown={(e) => e.key === 'Enter' && handleTabClick(session)}
					role="tab"
					tabindex="0"
					aria-selected={session.id === activeSessionId}
				>
					<span class="tab-icon">{getSessionIcon(session)}</span>
					<span class="tab-title">{truncateTitle(session.title)}</span>
					{#if session.status === "exited"}
						<span class="tab-status exited">✓</span>
					{/if}
					<button
						class="tab-close"
						onclick={(e) => handleCloseSession(e, session.id)}
						aria-label="Close session"
					>
						<X size={12} />
					</button>
				</div>
			{/each}
			<button class="new-session-btn" onclick={handleNewSession} aria-label="New session" title={selectedAgent ? `New ${selectedAgent.name} session` : 'New session'}>
				<Plus size={14} />
			</button>
		</div>
	{/if}

	<div class="panel-content" class:hidden={collapsed}>
		{#if sessions.length === 0}
			<div class="empty-state">
				<p>No active sessions</p>
				<p class="selected-agent">{selectedAgent?.name}</p>
				<Button variant="secondary" size="sm" onclick={handleNewSession}>
					<Plus size={14} />
					New Session
				</Button>
				<button class="settings-link" onclick={() => showSettings = true}>
					<Settings size={14} />
					Agent Settings
				</button>
			</div>
		{:else}
			{#each sessions as session (session.id)}
				<Terminal sessionId={session.id} active={session.id === activeSessionId} />
			{/each}
		{/if}
	</div>
</aside>

<Modal bind:open={showSettings} title="Agent Settings" onclose={() => showSettings = false}>
	<AgentSettings onclose={() => showSettings = false} />
</Modal>

<style>
	.agent-panel {
		display: flex;
		flex-direction: column;
		width: var(--dynamic-width, var(--panel-width));
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		transition: width var(--transition-normal);
		position: relative;
	}

	.agent-panel.collapsed {
		width: var(--sidebar-collapsed-width);
	}

	.agent-panel.resizing {
		transition: none;
		user-select: none;
	}

	.resize-handle {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		cursor: ew-resize;
		background: transparent;
		z-index: 10;
	}

	.resize-handle:hover,
	.agent-panel.resizing .resize-handle {
		background: var(--color-primary);
	}

	.agent-panel.collapsed .resize-handle {
		display: none;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--header-height);
		padding: 0 var(--spacing-sm);
		border-bottom: 1px solid var(--color-border-light);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--color-text);
	}

	.title {
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.icon-btn:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.session-tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-alt);
		border-bottom: 1px solid var(--color-border-light);
		overflow-x: auto;
		scrollbar-width: none;
		position: relative;
		z-index: 10;
	}

	.session-tabs::-webkit-scrollbar {
		display: none;
	}

	.session-tab {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: var(--color-text-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--transition-fast), border-color var(--transition-fast);
	}

	.session-tab:hover {
		background: var(--color-bg-hover);
	}

	.session-tab.active {
		background: var(--color-bg);
		border-color: var(--color-border-light);
		color: var(--color-text);
	}

	.tab-icon {
		font-size: 11px;
	}

	.tab-title {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-status.exited {
		color: var(--color-success);
		font-size: 10px;
	}

	.tab-close {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		background: transparent;
		border: none;
		border-radius: 2px;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--transition-fast), background var(--transition-fast);
	}

	.session-tab:hover .tab-close {
		opacity: 1;
	}

	.tab-close:hover {
		background: var(--color-danger-light);
		color: var(--color-danger);
	}

	.new-session-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background var(--transition-fast), border-color var(--transition-fast);
	}

	.new-session-btn:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-border-light);
		color: var(--color-text);
	}

	.panel-content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.panel-content.hidden {
		display: none;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-md);
		height: 100%;
		color: var(--color-text-muted);
	}

	.empty-state p {
		margin: 0;
	}

	.empty-state .selected-agent {
		font-size: 14px;
		color: var(--color-text);
	}

	.settings-link {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 12px;
		transition: color var(--transition-fast);
	}

	.settings-link:hover {
		color: var(--color-text);
	}
</style>
