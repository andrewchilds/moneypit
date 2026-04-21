import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, killSession, getSession, type PtySession } from "./pty";
import { getAgent, getDefaultAgent, type AgentConfig } from "../../agents/config";
import { generateSystemPrompt } from "../../agents/systemPrompt";

export type TaskType = "audit" | "categorize" | "suggest" | "general";

export interface SessionInfo {
	id: string;
	title: string;
	taskType: TaskType;
	agentId: string;
	accountId?: string;
	status: "starting" | "running" | "exited";
	createdAt: Date;
	exitCode?: number;
}

export interface CreateSessionOptions {
	taskType: TaskType;
	title: string;
	prompt?: string;
	accountId?: string;
	agentId?: string;
	customCommand?: string;
	initialArgs?: string;
	bookId?: string;
}

const MAX_SESSIONS = 10;
const PROMPT_FILE = path.join(os.tmpdir(), "moneypit-prompt.md");

const sessions = new Map<string, SessionInfo>();

/**
 * Builds the full prompt for an agent (system prompt + task prompt).
 */
function buildFullPrompt(agent: AgentConfig, options: CreateSessionOptions): string {
	let fullPrompt = '';
	if (!agent.readsClaudeMd) {
		fullPrompt = generateSystemPrompt(options.bookId) + '\n\n';
	}
	if (options.prompt) {
		fullPrompt += options.prompt;
	}
	return fullPrompt;
}

/**
 * Builds the command string to spawn an agent based on its config.
 */
function buildAgentCommand(agent: AgentConfig, options: CreateSessionOptions): string {
	// For custom agent, use the provided command directly
	if (agent.id === 'custom') {
		return options.customCommand || 'bash';
	}

	const parts: string[] = [agent.command];

	// Add default flags
	if (agent.defaultFlags) {
		parts.push(...agent.defaultFlags);
	}

	// Add user-provided initialArgs as command-line arguments
	if (options.initialArgs) {
		parts.push(options.initialArgs);
	}

	const fullPrompt = buildFullPrompt(agent, options);

	// Handle prompt based on agent's method
	if (fullPrompt) {
		switch (agent.promptMethod) {
			case 'stdin':
				// Write prompt to temp file and redirect
				fs.writeFileSync(PROMPT_FILE, fullPrompt, "utf-8");
				return `${parts.join(' ')} < ${PROMPT_FILE}`;

			case 'flag':
				if (agent.promptFlag) {
					// Escape the prompt for shell
					const escaped = fullPrompt.replace(/'/g, "'\\''");
					parts.push(agent.promptFlag, `'${escaped}'`);
				}
				break;

			case 'arg': {
				// Pass prompt as a positional argument
				const escaped = fullPrompt.replace(/'/g, "'\\''");
				parts.push(`'${escaped}'`);
				break;
			}

			case 'none':
				// No way to pass prompt, just run the command
				break;
		}
	}

	return parts.join(' ');
}

export function createSession(options: CreateSessionOptions): { session: PtySession; info: SessionInfo } {
	// Auto-close oldest sessions if at limit
	if (sessions.size >= MAX_SESSIONS) {
		const oldest = Array.from(sessions.values())
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
		if (oldest) {
			destroySession(oldest.id);
		}
	}

	const id = crypto.randomUUID();
	const projectDir = process.cwd();

	// Get agent config
	const agent = options.agentId ? getAgent(options.agentId) : getDefaultAgent();
	if (!agent) {
		throw new Error(`Unknown agent: ${options.agentId}`);
	}

	// Build the command based on agent type
	const command = buildAgentCommand(agent, options);
	console.log('[sessionManager] Spawning agent:', { agentId: agent.id, command, initialArgs: options.initialArgs });

	const info: SessionInfo = {
		id,
		title: options.title,
		taskType: options.taskType,
		agentId: agent.id,
		accountId: options.accountId,
		status: "starting",
		createdAt: new Date()
	};

	sessions.set(id, info);

	const ptySession = spawn(id, projectDir, command, []);

	// Update status when we get first output
	let hasOutput = false;
	ptySession.onData(() => {
		if (!hasOutput) {
			hasOutput = true;
			const s = sessions.get(id);
			if (s) {
				s.status = "running";
			}
		}
	});

	ptySession.onExit((code) => {
		const s = sessions.get(id);
		if (s) {
			s.status = "exited";
			s.exitCode = code;
		}
	});

	return { session: ptySession, info };
}

export function getSessionInfo(id: string): SessionInfo | undefined {
	return sessions.get(id);
}

export function listSessions(): SessionInfo[] {
	return Array.from(sessions.values()).sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
	);
}

export function destroySession(id: string): boolean {
	const info = sessions.get(id);
	if (!info) return false;

	killSession(id);
	sessions.delete(id);
	return true;
}

export function getPtySession(id: string): PtySession | undefined {
	return getSession(id);
}
