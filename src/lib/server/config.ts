import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { MoneypitConfig } from "$lib/config";
import { DEFAULT_CONFIG } from "$lib/config";

export function getConfigPath(): string {
	return join(homedir(), ".moneypit");
}

export function readConfig(): MoneypitConfig {
	const path = getConfigPath();
	if (!existsSync(path)) {
		return { ...DEFAULT_CONFIG };
	}
	try {
		const content = readFileSync(path, "utf-8");
		return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function writeConfig(config: MoneypitConfig): void {
	const path = getConfigPath();
	writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

export function updateConfig(updates: Partial<MoneypitConfig>): MoneypitConfig {
	const config = readConfig();
	const updated = { ...config, ...updates };
	writeConfig(updated);
	return updated;
}
