/**
 * Agent configuration for the right panel.
 * Each agent has different capabilities and command-line invocation patterns.
 */

export interface AgentConfig {
	id: string;
	name: string;
	/** Command to run (e.g., "claude", "aider", "codex") */
	command: string;
	/** Whether this agent reads CLAUDE.md automatically */
	readsClaudeMd: boolean;
	/** How to pass a system prompt to this agent */
	promptMethod: 'stdin' | 'flag' | 'arg' | 'none';
	/** Flag to use for system prompt (if promptMethod is 'flag') */
	promptFlag?: string;
	/** Additional default flags */
	defaultFlags?: string[];
	/** Optional args to append to the initial prompt */
	initialArgs?: string[];
	/** Description for the UI */
	description: string;
}

export const AGENTS: AgentConfig[] = [
	{
		id: 'claude',
		name: 'Claude Code',
		command: 'claude',
		readsClaudeMd: false,
		promptMethod: 'stdin',
		description: 'Anthropic Claude Code CLI'
	},
	{
		id: 'gemini',
		name: 'Gemini CLI',
		command: 'gemini',
		readsClaudeMd: false,
		promptMethod: 'stdin',
		description: 'Google Gemini CLI'
	},
	{
		id: 'codex',
		name: 'Codex CLI',
		command: 'codex',
		readsClaudeMd: false,
		promptMethod: 'arg',
		description: 'OpenAI Codex CLI'
	},
	{
		id: 'custom',
		name: 'Custom',
		command: '',
		readsClaudeMd: false,
		promptMethod: 'none',
		description: 'Run a custom command'
	}
];

export function getAgent(id: string): AgentConfig | undefined {
	return AGENTS.find(a => a.id === id);
}

export function getDefaultAgent(): AgentConfig {
	return AGENTS[0]; // Claude
}
