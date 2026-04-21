import * as pty from "node-pty";
import type { IPty } from "node-pty";

export interface PtySession {
	id: string;
	pty: IPty;
	onData: (callback: (data: string) => void) => void;
	onExit: (callback: (code: number) => void) => void;
	write: (data: string) => void;
	resize: (cols: number, rows: number) => void;
	kill: () => void;
}

// Use global to survive HMR reloads in development
const g = globalThis as Record<string, unknown>;
const sessionsKey = "__moneypit_pty_sessions__";
if (!g[sessionsKey]) {
	g[sessionsKey] = new Map<string, PtySession>();
}
const sessions = g[sessionsKey] as Map<string, PtySession>;

export function spawn(
	id: string,
	cwd: string,
	command: string,
	args: string[] = []
): PtySession {
	const shell = process.env.SHELL || "/bin/zsh";

	// Spawn through the shell to ensure user's PATH is available (e.g., nvm)
	// Use -l for login shell to source profile, -c to run command
	const shellArgs = command
		? ["-l", "-c", [command, ...args].join(" ")]
		: ["-l"];

	// Filter out undefined env values (node-pty requires string values only)
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";

	const ptyProcess = pty.spawn(shell, shellArgs, {
		name: "xterm-256color",
		cols: 80,
		rows: 24,
		cwd,
		env
	});

	const dataCallbacks: ((data: string) => void)[] = [];
	const exitCallbacks: ((code: number) => void)[] = [];

	ptyProcess.onData((data) => {
		for (const cb of dataCallbacks) {
			cb(data);
		}
	});

	ptyProcess.onExit(({ exitCode }) => {
		for (const cb of exitCallbacks) {
			cb(exitCode);
		}
		sessions.delete(id);
	});

	const session: PtySession = {
		id,
		pty: ptyProcess,
		onData: (callback) => {
			dataCallbacks.push(callback);
		},
		onExit: (callback) => {
			exitCallbacks.push(callback);
		},
		write: (data) => {
			ptyProcess.write(data);
		},
		resize: (cols, rows) => {
			ptyProcess.resize(cols, rows);
		},
		kill: () => {
			ptyProcess.kill();
			sessions.delete(id);
		}
	};

	sessions.set(id, session);
	return session;
}

export function getSession(id: string): PtySession | undefined {
	return sessions.get(id);
}

export function killSession(id: string): boolean {
	const session = sessions.get(id);
	if (session) {
		session.kill();
		return true;
	}
	return false;
}

export function listSessions(): string[] {
	return Array.from(sessions.keys());
}

export function getSessionCount(): number {
	return sessions.size;
}

// Log resource usage and session count periodically
const statsKey = "__moneypit_pty_stats__";

if (!g[statsKey]) {
	g[statsKey] = true;

	const STATS_INTERVAL_MS = 60_000;
	let lastCpuUsage = process.cpuUsage();
	let lastTime = Date.now();
	let isFirstCall = true;

	function logStats() {
		const mem = process.memoryUsage();
		const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

		let cpuStr = "N/A";
		if (!isFirstCall) {
			const now = Date.now();
			const elapsed = (now - lastTime) * 1000; // convert to microseconds
			const cpu = process.cpuUsage(lastCpuUsage);
			cpuStr = ((cpu.user + cpu.system) / elapsed * 100).toFixed(1) + "%";
			lastCpuUsage = process.cpuUsage();
			lastTime = now;
		}
		isFirstCall = false;

		console.log(
			`[stats] PTY sessions: ${sessions.size} | ` +
			`CPU: ${cpuStr} | ` +
			`Memory: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB heap, ${mb(mem.rss)} MB RSS`
		);
	}

	logStats();
	setInterval(logStats, STATS_INTERVAL_MS);
}
