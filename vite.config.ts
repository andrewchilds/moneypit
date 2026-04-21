import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { terminalWebSocket } from './src/lib/server/terminal/vitePlugin';

export default defineConfig({
	plugins: [sveltekit(), terminalWebSocket()],
	server: {
		port: 5180
	}
});
