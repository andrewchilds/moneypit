import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

export type TaskType = "audit" | "categorize" | "suggest" | "general";

export interface SessionInfo {
	id: string;
	title: string;
	taskType: TaskType;
	agentId: string;
	accountId?: string;
	status: "starting" | "running" | "exited";
	createdAt: string;
	exitCode?: number;
}

export interface AgentSettings {
	initialArgs: string;
	customCommand: string;
}

export interface SessionState {
	sessions: SessionInfo[];
	activeSessionId: string | null;
	connectionStatus: "connecting" | "connected" | "disconnected";
	panelOpen: boolean;
	selectedAgentId: string;
	agentSettings: Record<string, AgentSettings>;
}

const initialState: SessionState = {
	sessions: [],
	activeSessionId: null,
	connectionStatus: "disconnected",
	panelOpen: false,
	selectedAgentId: "claude",
	agentSettings: {}
};

function createSessionStore() {
	const { subscribe, update } = writable<SessionState>(initialState);

	let ws: WebSocket | null = null;
	let messageHandlers: ((msg: unknown) => void)[] = [];

	function connect() {
		if (!browser || ws?.readyState === WebSocket.OPEN) return;

		update((s) => ({ ...s, connectionStatus: "connecting" }));

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;

		ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			update((s) => ({ ...s, connectionStatus: "connected" }));
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				handleMessage(msg);
				// Notify any registered handlers (for Terminal component)
				messageHandlers.forEach((h) => h(msg));
			} catch {
				// Ignore invalid messages
			}
		};

		ws.onclose = () => {
			update((s) => ({ ...s, connectionStatus: "disconnected" }));
			ws = null;
		};

		ws.onerror = () => {
			update((s) => ({ ...s, connectionStatus: "disconnected" }));
		};
	}

	function handleMessage(msg: { type: string; sessions?: SessionInfo[]; sessionId?: string; error?: string }) {
		switch (msg.type) {
			case "sessions":
				if (msg.sessions) {
					// Ensure agentId has a default for backward compatibility
					const sessions = msg.sessions.map(session => ({
						...session,
						agentId: session.agentId || 'claude'
					}));
					update((s) => ({ ...s, sessions }));
				}
				break;

			case "attached":
				if (msg.sessionId) {
					update((s) => ({ ...s, activeSessionId: msg.sessionId! }));
				}
				break;

			case "detached":
				update((s) => ({ ...s, activeSessionId: null }));
				break;

			case "error":
				console.error("Session error:", msg.error);
				break;
		}
	}

	function send(msg: object) {
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	}

	function createSession(options: {
		taskType: TaskType;
		title: string;
		prompt?: string;
		accountId?: string;
		agentId?: string;
		customCommand?: string;
		initialArgs?: string;
		bookId?: string;
	}) {
		connect();
		// Use provided agentId or fall back to the selected agent
		const state = get({ subscribe });
		const agentId = options.agentId || state.selectedAgentId;

		// Use initialArgs from store (which is kept in sync with localStorage)
		const initialArgs = options.initialArgs || state.agentSettings[agentId]?.initialArgs || '';
		const customCommand = options.customCommand || state.agentSettings[agentId]?.customCommand || '';

		send({
			type: "create",
			...options,
			agentId,
			initialArgs,
			customCommand
		});
		// Open the panel when creating a session
		update((s) => ({ ...s, panelOpen: true }));
	}

	function setPanelOpen(open: boolean) {
		update((s) => ({ ...s, panelOpen: open }));
	}

	function setSelectedAgent(agentId: string) {
		update((s) => ({ ...s, selectedAgentId: agentId }));
		if (browser) {
			localStorage.setItem('selectedAgentId', agentId);
		}
	}

	function loadSelectedAgent() {
		if (browser) {
			const saved = localStorage.getItem('selectedAgentId');
			if (saved) {
				update((s) => ({ ...s, selectedAgentId: saved }));
			}
			loadAgentSettings();
		}
	}

	function loadAgentSettings() {
		if (browser) {
			const savedSettings = localStorage.getItem('agentSettings');
			if (savedSettings) {
				try {
					const agentSettings = JSON.parse(savedSettings);
					update((s) => ({ ...s, agentSettings }));
				} catch {
					// Ignore parse errors
				}
			}
		}
	}

	function updateAgentSettings(agentSettings: Record<string, AgentSettings>) {
		update((s) => ({ ...s, agentSettings }));
		if (browser) {
			localStorage.setItem('agentSettings', JSON.stringify(agentSettings));
		}
	}

	function attachSession(sessionId: string) {
		send({ type: "attach", sessionId });
	}

	function killSession(sessionId: string) {
		send({ type: "kill", sessionId });
	}

	function refreshSessions() {
		send({ type: "list" });
	}

	function sendInput(data: string) {
		send({ type: "input", data });
	}

	function sendResize(cols: number, rows: number) {
		send({ type: "resize", cols, rows });
	}

	function onMessage(handler: (msg: unknown) => void) {
		messageHandlers.push(handler);
		return () => {
			messageHandlers = messageHandlers.filter((h) => h !== handler);
		};
	}

	function getActiveSession(): SessionInfo | null {
		const state = get({ subscribe });
		return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
	}

	return {
		subscribe,
		connect,
		createSession,
		attachSession,
		killSession,
		refreshSessions,
		sendInput,
		sendResize,
		onMessage,
		getActiveSession,
		setPanelOpen,
		setSelectedAgent,
		loadSelectedAgent,
		updateAgentSettings
	};
}

export const sessionStore = createSessionStore();
