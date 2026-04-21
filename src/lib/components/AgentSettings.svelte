<script lang="ts">
	import { AGENTS } from "$lib/agents/config";
	import { sessionStore, type AgentSettings } from "$lib/stores/sessions";
	import Button from "./ui/Button.svelte";
	import Tabs from "./ui/Tabs.svelte";

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	// Initialize from store
	let defaultAgentId = $state($sessionStore.selectedAgentId);
	let agentSettings = $state<Record<string, AgentSettings>>({ ...$sessionStore.agentSettings });
	let selectedTab = $state($sessionStore.selectedAgentId);

	const agentTabs = AGENTS.map(a => ({ id: a.id, label: a.name }));

	function getSettings(agentId: string): AgentSettings {
		return agentSettings[agentId] || { initialArgs: "", customCommand: "" };
	}

	function updateSettings(agentId: string, field: keyof AgentSettings, value: string) {
		agentSettings = {
			...agentSettings,
			[agentId]: {
				...getSettings(agentId),
				[field]: value
			}
		};
	}

	function handleSave() {
		sessionStore.setSelectedAgent(defaultAgentId);
		sessionStore.updateAgentSettings(agentSettings);
		onclose();
	}
</script>

<div class="settings">
	<div class="setting-group">
		<label for="default-agent">Default Agent</label>
		<select id="default-agent" bind:value={defaultAgentId}>
			{#each AGENTS as agent (agent.id)}
				<option value={agent.id}>{agent.name}</option>
			{/each}
		</select>
	</div>

	<hr />

	<h3>Agent Configuration</h3>

	<Tabs tabs={agentTabs} bind:value={selectedTab} />

	{#each AGENTS as agent (agent.id)}
		{#if selectedTab === agent.id}
			<div class="agent-config">
				{#if agent.id === "custom"}
					<div class="setting-group">
						<label for="custom-command">Command</label>
						<input
							id="custom-command"
							type="text"
							placeholder="e.g., aider --model gpt-4"
							value={getSettings(agent.id).customCommand}
							oninput={(e) => updateSettings(agent.id, "customCommand", e.currentTarget.value)}
						/>
					</div>
				{/if}

				<div class="setting-group">
					<label for="args-{agent.id}">Initial Arguments</label>
					<input
						id="args-{agent.id}"
						type="text"
						placeholder="e.g., --dangerously-skip-permissions, --model [model name]"
						value={getSettings(agent.id).initialArgs}
						oninput={(e) => updateSettings(agent.id, "initialArgs", e.currentTarget.value)}
					/>
					<span class="hint">Arguments appended to the command</span>
				</div>

				<div class="agent-info">
					<span class="info-label">Command:</span>
					<code>{agent.command || '(custom)'}</code>
				</div>
				</div>
		{/if}
	{/each}

	<div class="actions">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		<Button variant="primary" onclick={handleSave}>Save</Button>
	</div>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.setting-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.setting-group label {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text);
	}

	.setting-group select,
	.setting-group input {
		padding: var(--spacing-sm);
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: 13px;
	}

	.setting-group select:focus,
	.setting-group input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.hint {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	hr {
		border: none;
		border-top: 1px solid var(--color-border-light);
		margin: var(--spacing-sm) 0;
	}

	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
	}

	.agent-config {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
	}

	.agent-info {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.agent-info code {
		font-family: var(--font-mono);
		background: var(--color-bg);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.info-label {
		font-weight: 500;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}
</style>
