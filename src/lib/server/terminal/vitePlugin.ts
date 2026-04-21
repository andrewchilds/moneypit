import type { Plugin } from "vite";
import { setupTerminalWebSocket } from "./wsServer";

export function terminalWebSocket(): Plugin {
	return {
		name: "terminal-websocket",
		configureServer(server) {
			if (server.httpServer) {
				setupTerminalWebSocket(server.httpServer);
				console.log("Terminal WebSocket server ready at /ws/terminal");
			}
		}
	};
}
