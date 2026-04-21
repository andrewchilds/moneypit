import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import {
	createSession,
	destroySession,
	listSessions,
	getPtySession,
	type TaskType,
	type SessionInfo
} from "./sessionManager";
import type { PtySession } from "./pty";

interface ClientMessage {
	type: "input" | "resize" | "create" | "attach" | "detach" | "kill" | "list";
	// For input
	data?: string;
	// For resize
	cols?: number;
	rows?: number;
	// For create
	taskType?: TaskType;
	title?: string;
	prompt?: string;
	accountId?: string;
	agentId?: string;
	customCommand?: string;
	initialArgs?: string;
	bookId?: string;
	// For attach/kill
	sessionId?: string;
}

interface ServerMessage {
	type: "output" | "exit" | "attached" | "detached" | "sessions" | "error";
	data?: string;
	code?: number;
	sessionId?: string;
	sessions?: SessionInfo[];
	error?: string;
}

type UpgradeListener = (
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer
) => void;

interface HttpServerLike {
	on(event: "upgrade", listener: UpgradeListener): void;
}

interface ClientState {
	attachedSessionId: string | null;
	cleanup: (() => void) | null;
}

function send(ws: WebSocket, msg: ServerMessage) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

function attachToSession(ws: WebSocket, state: ClientState, session: PtySession, sessionId: string) {
	// Detach from current session first
	if (state.cleanup) {
		state.cleanup();
	}

	state.attachedSessionId = sessionId;

	const onData = (data: string) => {
		send(ws, { type: "output", data });
	};

	const onExit = (code: number) => {
		send(ws, { type: "exit", sessionId, code });
	};

	session.onData(onData);
	session.onExit(onExit);

	state.cleanup = () => {
		// Note: node-pty doesn't support removing listeners, but the session
		// will be destroyed when killed anyway. This is just for state tracking.
		state.attachedSessionId = null;
		state.cleanup = null;
	};

	send(ws, { type: "attached", sessionId });
}

export function setupTerminalWebSocket(
	server: HttpServerLike,
	path = "/ws/terminal"
) {
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		const url = new URL(request.url || "", `http://${request.headers.host}`);

		if (url.pathname === path) {
			wss.handleUpgrade(request, socket, head, (ws) => {
				wss.emit("connection", ws, request);
			});
		}
	});

	wss.on("connection", (ws: WebSocket) => {
		const state: ClientState = {
			attachedSessionId: null,
			cleanup: null
		};

		// Send initial session list
		send(ws, { type: "sessions", sessions: listSessions() });

		ws.on("message", (rawData) => {
			try {
				const msg: ClientMessage = JSON.parse(rawData.toString());

				switch (msg.type) {
					case "list": {
						send(ws, { type: "sessions", sessions: listSessions() });
						break;
					}

					case "create": {
						if (!msg.title || !msg.taskType) {
							send(ws, { type: "error", error: "Missing title or taskType" });
							break;
						}

						try {
							const { session, info } = createSession({
								taskType: msg.taskType,
								title: msg.title,
								prompt: msg.prompt,
								accountId: msg.accountId,
								agentId: msg.agentId,
								customCommand: msg.customCommand,
								initialArgs: msg.initialArgs,
								bookId: msg.bookId
							});

							attachToSession(ws, state, session, info.id);
							// Broadcast updated session list
							send(ws, { type: "sessions", sessions: listSessions() });
						} catch (err) {
							const errorMsg = err instanceof Error ? err.message : "Unknown error";
							send(ws, { type: "error", error: `Failed to create session: ${errorMsg}` });
						}
						break;
					}

					case "attach": {
						if (!msg.sessionId) {
							send(ws, { type: "error", error: "Missing sessionId" });
							break;
						}

						const session = getPtySession(msg.sessionId);
						if (!session) {
							send(ws, { type: "error", error: "Session not found" });
							break;
						}

						attachToSession(ws, state, session, msg.sessionId);
						break;
					}

					case "detach": {
						if (state.cleanup) {
							state.cleanup();
						}
						send(ws, { type: "detached" });
						break;
					}

					case "kill": {
						if (!msg.sessionId) {
							send(ws, { type: "error", error: "Missing sessionId" });
							break;
						}

						// If killing the attached session, detach first
						if (state.attachedSessionId === msg.sessionId && state.cleanup) {
							state.cleanup();
						}

						destroySession(msg.sessionId);
						send(ws, { type: "sessions", sessions: listSessions() });
						break;
					}

					case "input": {
						if (state.attachedSessionId && msg.data !== undefined) {
							const session = getPtySession(state.attachedSessionId);
							session?.write(msg.data);
						}
						break;
					}

					case "resize": {
						if (state.attachedSessionId && msg.cols !== undefined && msg.rows !== undefined) {
							const session = getPtySession(state.attachedSessionId);
							session?.resize(msg.cols, msg.rows);
						}
						break;
					}
				}
			} catch {
				// Ignore invalid messages
			}
		});

		ws.on("close", () => {
			if (state.cleanup) {
				state.cleanup();
			}
			// Note: we don't kill sessions on disconnect - they stay alive
		});

		ws.on("error", () => {
			if (state.cleanup) {
				state.cleanup();
			}
		});
	});

	return wss;
}
