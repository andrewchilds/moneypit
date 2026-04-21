import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import 'dotenv/config';

const BACKUP_PATH = process.env.BACKUP_PATH;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BACKUP_PATH) {
	console.error('Error: BACKUP_PATH not set in environment');
	process.exit(1);
}

if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL not set in environment');
	process.exit(1);
}

const backupDir = dirname(BACKUP_PATH);
if (!existsSync(backupDir)) {
	mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = `${BACKUP_PATH}-${timestamp}.sql`;

console.log(`Backing up database to ${backupFile}...`);

try {
	execSync(`pg_dump "${DATABASE_URL}" > "${backupFile}"`, {
		stdio: ['pipe', 'pipe', 'inherit']
	});
	console.log('Backup complete!');
} catch (error) {
	console.error('Backup failed:', error);
	process.exit(1);
}
