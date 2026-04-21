import { writable } from "svelte/store";

interface SettingsState {
	open: boolean;
	initialTab?: string;
}

function createSettingsStore() {
	const { subscribe, set, update } = writable<SettingsState>({ open: false });

	return {
		subscribe,
		open: (tab?: string) => set({ open: true, initialTab: tab }),
		close: () => set({ open: false }),
		toggle: () => update((s) => ({ ...s, open: !s.open }))
	};
}

export const settingsStore = createSettingsStore();
