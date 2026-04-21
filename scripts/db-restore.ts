import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
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
const backupFile = process.argv[2];

function listBackups() {
	if (!existsSync(backupDir)) {
		console.log('No backups found.');
		return [];
	}

	const files = readdirSync(backupDir)
		.filter(f => f.endsWith('.sql'))
		.map(f => ({ name: f, path: join(backupDir, f), mtime: statSync(join(backupDir, f)).mtime }))
		.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

	return files;
}

function restore(filePath: string) {
	if (!existsSync(filePath)) {
		console.error(`Error: Backup file not found: ${filePath}`);
		process.exit(1);
	}

	console.log(`Restoring database from ${filePath}...`);
	console.log('WARNING: This will overwrite all existing data!');

	try {
		execSync(`psql "${DATABASE_URL}" < "${filePath}"`, {
			stdio: 'inherit'
		});
		console.log('Restore complete!');
	} catch (error) {
		console.error('Restore failed:', error);
		process.exit(1);
	}
}

if (!backupFile) {
	const backups = listBackups();
	if (backups.length === 0) {
		console.log('No backups available.');
		process.exit(0);
	}

	console.log('Available backups:\n');
	backups.forEach((b, i) => {
		console.log(`  ${i + 1}. ${b.name} (${b.mtime.toLocaleString()})`);
	});
	console.log('\nUsage: npm run db:restore <filename or number>');
	console.log('Example: npm run db:restore 1  (restores most recent)');
	console.log(`Example: npm run db:restore ${backups[0]?.name}`);
} else {
	let filePath: string;

	const num = parseInt(backupFile, 10);
	if (!isNaN(num) && num > 0) {
		const backups = listBackups();
		if (num > backups.length) {
			console.error(`Error: Backup #${num} not found. Only ${backups.length} backups available.`);
			process.exit(1);
		}
		filePath = backups[num - 1].path;
	} else if (backupFile.startsWith('/')) {
		filePath = backupFile;
	} else {
		filePath = join(backupDir, backupFile);
	}

	restore(filePath);
}
