<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import { sessionStore } from "$lib/stores/sessions";
	import "@xterm/xterm/css/xterm.css";

	interface Props {
		sessionId: string;
		active: boolean;
	}

	let { sessionId, active }: Props = $props();

	let containerEl: HTMLDivElement;
	let terminal: import("@xterm/xterm").Terminal | null = null;
	let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let unsubscribeMessages: (() => void) | null = null;

	function handleMessage(msg: unknown) {
		const m = msg as { type: string; data?: string; code?: number; sessionId?: string };
		if (m.type === "output" && m.data) {
			terminal?.write(m.data);
		} else if (m.type === "exit" && m.sessionId === sessionId) {
			terminal?.write(`\r\n\x1b[90m[Process exited with code ${m.code}]\x1b[0m\r\n`);
		}
	}

	// Refit when becoming active
	$effect(() => {
		if (active && fitAddon && terminal) {
			// Small delay to ensure container is visible
			setTimeout(() => {
				fitAddon?.fit();
				sessionStore.sendResize(terminal!.cols, terminal!.rows);
			}, 10);
		}
	});

	onMount(async () => {
		if (!browser) return;

		const { Terminal } = await import("@xterm/xterm");
		const { FitAddon } = await import("@xterm/addon-fit");
		const { WebLinksAddon } = await import("@xterm/addon-web-links");

		terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			fontFamily: "Menlo, Monaco, 'Courier New', monospace",
			theme: {
				background: "#1e1e1e",
				foreground: "#d4d4d4",
				cursor: "#d4d4d4",
				selectionBackground: "#264f78",
				black: "#1e1e1e",
				red: "#f44747",
				green: "#6a9955",
				yellow: "#dcdcaa",
				blue: "#569cd6",
				magenta: "#c586c0",
				cyan: "#4ec9b0",
				white: "#d4d4d4",
				brightBlack: "#808080",
				brightRed: "#f44747",
				brightGreen: "#6a9955",
				brightYellow: "#dcdcaa",
				brightBlue: "#569cd6",
				brightMagenta: "#c586c0",
				brightCyan: "#4ec9b0",
				brightWhite: "#ffffff"
			}
		});

		fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(containerEl);
		fitAddon.fit();

		terminal.onData((data) => {
			sessionStore.sendInput(data);
		});

		// Handle resize
		resizeObserver = new ResizeObserver(() => {
			if (fitAddon && terminal && active) {
				fitAddon.fit();
				sessionStore.sendResize(terminal.cols, terminal.rows);
			}
		});
		resizeObserver.observe(containerEl);

		// Listen for messages from the session store
		unsubscribeMessages = sessionStore.onMessage(handleMessage);

		// Send initial size
		sessionStore.sendResize(terminal.cols, terminal.rows);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		unsubscribeMessages?.();
		terminal?.dispose();
	});
</script>

<div class="terminal-container" class:hidden={!active} bind:this={containerEl}></div>

<style>
	.terminal-container {
		width: 100%;
		height: 100%;
		background: #1e1e1e;
	}

	.terminal-container.hidden {
		display: none;
	}

	.terminal-container :global(.xterm) {
		height: 100%;
		padding: 8px;
	}

	.terminal-container :global(.xterm-viewport) {
		overflow-y: auto !important;
	}
</style>
