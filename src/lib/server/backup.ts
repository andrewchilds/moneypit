import { exec } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { db } from './db';

const BACKUP_PATH = process.env.BACKUP_PATH;
const DATABASE_URL = process.env.DATABASE_URL;
const MAX_BACKUPS = 10;
const BACKUP_INTERVAL = 50; // Backup every N operations
const DEBOUNCE_MS = 5000; // Wait 5s after last operation before backing up

let lastBackupCount = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBackupCheck(): void {
	if (!BACKUP_PATH || !DATABASE_URL) return;

	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}

	debounceTimer = setTimeout(async () => {
		debounceTimer = null;
		const currentCount = await db.operationLog.count();

		if (lastBackupCount === 0) {
			lastBackupCount = currentCount;
			return;
		}

		if (currentCount - lastBackupCount >= BACKUP_INTERVAL) {
			runBackup();
			lastBackupCount = currentCount;
		}
	}, DEBOUNCE_MS);
}

export function runBackup(): void {
	if (!BACKUP_PATH || !DATABASE_URL) {
		console.log('[backup] Skipping: BACKUP_PATH or DATABASE_URL not set');
		return;
	}

	const backupDir = dirname(BACKUP_PATH);
	if (!existsSync(backupDir)) {
		mkdirSync(backupDir, { recursive: true });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupFile = `${BACKUP_PATH}-${timestamp}.sql`;

	console.log(`[backup] Backing up database to ${backupFile}...`);

	exec(`pg_dump "${DATABASE_URL}" > "${backupFile}"`, (error) => {
		if (error) {
			console.error('[backup] Backup failed:', error);
		} else {
			cleanOldBackups(backupDir);
			console.log('[backup] Backup complete!');
		}
	});
}

function cleanOldBackups(backupDir: string) {
	const files = readdirSync(backupDir)
		.filter(f => f.endsWith('.sql'))
		.map(f => ({ name: f, path: join(backupDir, f), mtime: statSync(join(backupDir, f)).mtime }))
		.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

	for (const file of files.slice(MAX_BACKUPS)) {
		unlinkSync(file.path);
		console.log(`[backup] Removed old backup: ${file.name}`);
	}
}
