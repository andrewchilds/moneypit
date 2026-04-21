// Shared config types (used by both server and client)

export interface MoneypitConfig {
	defaultBookId?: string;
	cliOutputFormat?: "json" | "table";
}

export const DEFAULT_CONFIG: MoneypitConfig = {};
