/**
 * E2E Test Setup
 *
 * This module provides helpers for running e2e tests against a real PostgreSQL database.
 * IMPORTANT: Tests use a separate database (moneypit_test) to avoid touching production data.
 *
 * Run tests via the test script which handles database setup:
 *   ./scripts/test.sh e2e
 */

import { execSync } from 'child_process';

const TEST_DB_NAME = 'moneypit_test';
const TEST_DB_URL = `postgresql://moneypit_test:moneypit_test@localhost:5432/${TEST_DB_NAME}`;

// Track the current test book ID for isolation
let testBookId: string | null = null;

interface Book {
	id: string;
	name: string;
	description: string | null;
	isDemo: boolean;
}

/**
 * Runs a bin/mp CLI command and returns the result.
 */
export function runMp(args: string): { stdout: string; stderr: string; exitCode: number } {
	try {
		const stdout = execSync(`bin/mp ${args}`, {
			cwd: process.cwd(),
			env: { ...process.env, DATABASE_URL: TEST_DB_URL },
			encoding: 'utf-8'
		});
		return { stdout, stderr: '', exitCode: 0 };
	} catch (error: unknown) {
		const execError = error as { stdout?: string; stderr?: string; status?: number };
		return {
			stdout: execError.stdout || '',
			stderr: execError.stderr || '',
			exitCode: execError.status || 1
		};
	}
}

/**
 * Runs a bin/mp CLI command and parses JSON output.
 */
export function runMpJson<T>(args: string): T {
	const { stdout, stderr, exitCode } = runMp(args);
	if (exitCode !== 0) {
		throw new Error(`Command failed: bin/mp ${args}\n${stderr}\n${stdout}`);
	}
	return JSON.parse(stdout) as T;
}

/**
 * Creates a test book and returns its ID.
 * Call this in beforeAll() for test suites that need isolation.
 */
export function createTestBook(name?: string): string {
	const bookName = name ?? `test-${Date.now()}`;
	const result = runMpJson<Book>(`book:create "${bookName}"`);
	testBookId = result.id;
	return result.id;
}

/**
 * Gets the current test book ID, creating one if needed.
 */
export function getTestBookId(): string {
	if (!testBookId) {
		testBookId = createTestBook();
	}
	return testBookId;
}

/**
 * Resets the test book ID (for use in afterAll cleanup).
 */
export function resetTestBookId(): void {
	testBookId = null;
}

/**
 * Runs a CLI command with the test book.
 */
export function runMpWithBook(args: string, bookId?: string): { stdout: string; stderr: string; exitCode: number } {
	const book = bookId ?? getTestBookId();
	return runMp(`--book ${book} ${args}`);
}

/**
 * Runs a CLI command with the test book and parses JSON.
 */
export function runMpJsonWithBook<T>(args: string, bookId?: string): T {
	const book = bookId ?? getTestBookId();
	return runMpJson<T>(`--book ${book} ${args}`);
}

/**
 * Deletes the test book (cleanup).
 */
export function deleteTestBook(bookId?: string): void {
	const id = bookId ?? testBookId;
	if (id) {
		runMp(`book:delete ${id} --force`);
		if (id === testBookId) {
			testBookId = null;
		}
	}
}

export { TEST_DB_URL, TEST_DB_NAME };
