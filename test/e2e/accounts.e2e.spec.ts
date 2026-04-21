import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Account {
	id: string;
	type: string;
	path: string;
	last4: string | null;
}

describe('Account CRUD', () => {
	let bookId: string;

	beforeAll(() => {
		bookId = createTestBook('Account Tests');
	});

	afterAll(() => {
		deleteTestBook(bookId);
		resetTestBookId();
	});

	it('creates an account', () => {
		const account = runMpJsonWithBook<Account>('account:create --type asset --path "Test Checking"', bookId);

		expect(account.id).toBeDefined();
		expect(account.type).toBe('ASSET');
		expect(account.path).toBe('Test Checking');
	});

	it('lists accounts', () => {
		// Create another account
		runMpWithBook('account:create --type expense --path "Test:Groceries"', bookId);

		const accounts = runMpJsonWithBook<Account[]>('account:list', bookId);

		expect(accounts.length).toBeGreaterThanOrEqual(2);
		expect(accounts.some((a) => a.path === 'Test Checking')).toBe(true);
		expect(accounts.some((a) => a.path === 'Test:Groceries')).toBe(true);
	});

	it('filters accounts by type', () => {
		const assets = runMpJsonWithBook<Account[]>('account:list --type asset', bookId);

		expect(assets.every((a) => a.type === 'ASSET')).toBe(true);
		expect(assets.some((a) => a.path === 'Test Checking')).toBe(true);
	});

	it('gets a single account', () => {
		const accounts = runMpJsonWithBook<Account[]>('account:list --type asset', bookId);
		const testAccount = accounts.find((a) => a.path === 'Test Checking');

		const account = runMpJsonWithBook<Account>(`account:get ${testAccount!.id}`, bookId);

		expect(account.path).toBe('Test Checking');
		expect(account.type).toBe('ASSET');
	});

	it('updates an account', () => {
		const accounts = runMpJsonWithBook<Account[]>('account:list --type asset', bookId);
		const testAccount = accounts.find((a) => a.path === 'Test Checking');

		const updated = runMpJsonWithBook<Account>(
			`account:update ${testAccount!.id} --path "Updated Checking" --last4 1234`,
			bookId
		);

		expect(updated.path).toBe('Updated Checking');
		expect(updated.last4).toBe('1234');
	});

	it('deletes an account', () => {
		// Create a temporary account to delete
		const temp = runMpJsonWithBook<Account>('account:create --type expense --path "To Delete"', bookId);

		const { stdout } = runMpWithBook(`account:delete ${temp.id}`, bookId);
		expect(stdout).toContain('Deleted account');

		// Verify it's gone
		const { exitCode } = runMpWithBook(`account:get ${temp.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});
});
