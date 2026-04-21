import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMp, runMpJson, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Book {
	id: string;
	name: string;
	description: string | null;
	isDemo: boolean;
}

interface Account {
	id: string;
	type: string;
	path: string;
}

/**
 * Helper to get all book IDs from book:list output.
 * The output format is: "<id>  <name>[demo][current]"
 */
function getAllBookIds(): string[] {
	const { stdout } = runMp('book:list');
	if (!stdout.trim()) return [];

	const ids: string[] = [];
	for (const line of stdout.split('\n')) {
		// Book IDs start at the beginning of lines
		const match = line.match(/^([a-z0-9]+)\s+/);
		if (match) {
			ids.push(match[1]);
		}
	}
	return ids;
}

/**
 * Helper to delete all books (used to set up clean state for resolution tests)
 */
function deleteAllBooks(): void {
	const ids = getAllBookIds();
	for (const id of ids) {
		runMp(`book:delete ${id} --force`);
	}
}

describe('Book CRUD', () => {
	let testBookId: string;

	beforeAll(() => {
		testBookId = createTestBook('E2E Test Book');
	});

	afterAll(() => {
		deleteTestBook(testBookId);
		resetTestBookId();
	});

	it('lists books including test book', () => {
		const { stdout } = runMp('book:list');
		expect(stdout).toContain('E2E Test Book');
	});

	it('gets a book by ID', () => {
		const book = runMpJson<Book>(`book:get ${testBookId}`);
		expect(book.name).toBe('E2E Test Book');
		expect(book.isDemo).toBe(false);
	});

	it('creates a new book', () => {
		const book = runMpJson<Book>('book:create "Another Test Book" --description "Test description"');
		expect(book.name).toBe('Another Test Book');
		expect(book.description).toBe('Test description');

		// Cleanup
		runMp(`book:delete ${book.id} --force`);
	});

	it('creates a demo book', () => {
		const book = runMpJson<Book>('book:create "Demo Book Test" --demo');
		expect(book.name).toBe('Demo Book Test');
		expect(book.isDemo).toBe(true);

		// Cleanup
		runMp(`book:delete ${book.id} --force`);
	});

	it('updates a book name', () => {
		const updated = runMpJson<Book>(`book:update ${testBookId} --name "Renamed Book"`);
		expect(updated.name).toBe('Renamed Book');

		// Restore original name
		runMp(`book:update ${testBookId} --name "E2E Test Book"`);
	});

	it('updates a book description', () => {
		const updated = runMpJson<Book>(`book:update ${testBookId} --description "New description"`);
		expect(updated.description).toBe('New description');
	});

	it('switches default book', () => {
		const { stdout } = runMp(`book:switch ${testBookId}`);
		expect(stdout).toContain('Switched to book');

		const { stdout: current } = runMp('book:current');
		expect(current).toContain('E2E Test Book');
	});

	it('deletes a book', () => {
		const temp = runMpJson<Book>('book:create "To Delete Book"');

		const { stdout } = runMp(`book:delete ${temp.id} --force`);
		expect(stdout).toContain('Deleted book');

		// Verify it's gone
		const { exitCode } = runMp(`book:get ${temp.id}`);
		expect(exitCode).not.toBe(0);
	});
});

describe('Book Isolation', () => {
	let book1Id: string;
	let book2Id: string;

	beforeAll(() => {
		book1Id = createTestBook('Isolation Book 1');
		book2Id = runMpJson<Book>('book:create "Isolation Book 2"').id;
	});

	afterAll(() => {
		runMp(`book:delete ${book1Id} --force`);
		runMp(`book:delete ${book2Id} --force`);
		resetTestBookId();
	});

	it('accounts in one book are not visible in another', () => {
		// Create account in book 1
		runMpJson<Account>(`--book ${book1Id} account:create --type asset --path "Book1 Checking"`);

		// Create account in book 2
		runMpJson<Account>(`--book ${book2Id} account:create --type asset --path "Book2 Checking"`);

		// List accounts in book 1
		const book1Accounts = runMpJson<Account[]>(`--book ${book1Id} account:list`);
		expect(book1Accounts.some((a) => a.path === 'Book1 Checking')).toBe(true);
		expect(book1Accounts.some((a) => a.path === 'Book2 Checking')).toBe(false);

		// List accounts in book 2
		const book2Accounts = runMpJson<Account[]>(`--book ${book2Id} account:list`);
		expect(book2Accounts.some((a) => a.path === 'Book2 Checking')).toBe(true);
		expect(book2Accounts.some((a) => a.path === 'Book1 Checking')).toBe(false);
	});

	it('same account path can exist in different books', () => {
		// Create same-named account in both books
		const acc1 = runMpJson<Account>(`--book ${book1Id} account:create --type expense --path "Groceries"`);
		const acc2 = runMpJson<Account>(`--book ${book2Id} account:create --type expense --path "Groceries"`);

		expect(acc1.id).not.toBe(acc2.id);
	});

	it('transactions in one book are not visible in another', () => {
		// Get existing accounts
		const book1Accounts = runMpJson<Account[]>(`--book ${book1Id} account:list --type asset`);
		const book2Accounts = runMpJson<Account[]>(`--book ${book2Id} account:list --type asset`);
		const acc1 = book1Accounts[0];
		const acc2 = book2Accounts[0];

		// Create transaction in book 1
		runMpJson(
			`--book ${book1Id} tx:create --date 2026-04-01 --description "Book1 TX" --amount 100 --credit ${acc1.id}`
		);

		// Create transaction in book 2
		runMpJson(
			`--book ${book2Id} tx:create --date 2026-04-01 --description "Book2 TX" --amount 200 --credit ${acc2.id}`
		);

		// Verify isolation
		const book1Txs = runMpJson<{ description: string }[]>(`--book ${book1Id} tx:list --limit 100`);
		expect(book1Txs.some((t) => t.description === 'Book1 TX')).toBe(true);
		expect(book1Txs.some((t) => t.description === 'Book2 TX')).toBe(false);

		const book2Txs = runMpJson<{ description: string }[]>(`--book ${book2Id} tx:list --limit 100`);
		expect(book2Txs.some((t) => t.description === 'Book2 TX')).toBe(true);
		expect(book2Txs.some((t) => t.description === 'Book1 TX')).toBe(false);
	});

	it('rules in one book are not visible in another', () => {
		// Get expense accounts for rules
		const book1Accounts = runMpJson<Account[]>(`--book ${book1Id} account:list --type expense`);
		const book2Accounts = runMpJson<Account[]>(`--book ${book2Id} account:list --type expense`);

		// Create rule in book 1
		runMpJson(`--book ${book1Id} rule:create "BOOK1_PATTERN" --account ${book1Accounts[0].id}`);

		// Create rule in book 2
		runMpJson(`--book ${book2Id} rule:create "BOOK2_PATTERN" --account ${book2Accounts[0].id}`);

		// Verify isolation
		const book1Rules = runMpJson<{ pattern: string }[]>(`--book ${book1Id} rule:list`);
		expect(book1Rules.some((r) => r.pattern === 'BOOK1_PATTERN')).toBe(true);
		expect(book1Rules.some((r) => r.pattern === 'BOOK2_PATTERN')).toBe(false);

		const book2Rules = runMpJson<{ pattern: string }[]>(`--book ${book2Id} rule:list`);
		expect(book2Rules.some((r) => r.pattern === 'BOOK2_PATTERN')).toBe(true);
		expect(book2Rules.some((r) => r.pattern === 'BOOK1_PATTERN')).toBe(false);
	});
});

describe('Book Resolution', () => {
	afterAll(() => {
		// Clean up any config changes
		runMp('config:set defaultBookId ""');
		resetTestBookId();
	});

	it('auto-selects when only one non-demo book exists', () => {
		// Clear config default
		runMp('config:set defaultBookId ""');

		// Delete any existing books first
		deleteAllBooks();

		// Create single non-demo book
		const book = runMpJson<Book>('book:create "Only Book"');

		// Command should work without --book flag
		const accounts = runMpJson<Account[]>('account:list');
		expect(Array.isArray(accounts)).toBe(true);

		// Cleanup
		runMp(`book:delete ${book.id} --force`);
	});

	it('fails with helpful error when multiple books and no default', () => {
		// Clear config default
		runMp('config:set defaultBookId ""');

		// Delete any existing books
		deleteAllBooks();

		// Create two non-demo books
		const book1 = runMpJson<Book>('book:create "Multi Book 1"');
		const book2 = runMpJson<Book>('book:create "Multi Book 2"');

		// Command should fail with helpful message
		const { stderr, exitCode } = runMp('account:list');
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('Multiple books found');
		expect(stderr).toContain('book:switch');

		// Cleanup
		runMp(`book:delete ${book1.id} --force`);
		runMp(`book:delete ${book2.id} --force`);
	});

	it('ignores demo books when auto-selecting', () => {
		// Clear config default
		runMp('config:set defaultBookId ""');

		// Delete any existing books
		deleteAllBooks();

		// Create one demo book and one regular book
		const demoBook = runMpJson<Book>('book:create "Demo Test" --demo');
		const realBook = runMpJson<Book>('book:create "Real Book"');

		// Should auto-select the non-demo book
		const { exitCode } = runMp('account:list');
		expect(exitCode).toBe(0);

		// Cleanup
		runMp(`book:delete ${demoBook.id} --force`);
		runMp(`book:delete ${realBook.id} --force`);
	});

	it('--book flag overrides config default', () => {
		// Create two books
		const book1 = runMpJson<Book>('book:create "Override Test 1"');
		const book2 = runMpJson<Book>('book:create "Override Test 2"');

		// Set book1 as default
		runMp(`book:switch ${book1.id}`);

		// Create account in book1
		runMpJson<Account>(`--book ${book1.id} account:create --type asset --path "In Book 1"`);

		// Create account in book2 using --book override
		runMpJson<Account>(`--book ${book2.id} account:create --type asset --path "In Book 2"`);

		// Verify book2 has the right account
		const book2Accounts = runMpJson<Account[]>(`--book ${book2.id} account:list`);
		expect(book2Accounts.some((a) => a.path === 'In Book 2')).toBe(true);
		expect(book2Accounts.some((a) => a.path === 'In Book 1')).toBe(false);

		// Verify default (book1) has its account
		const book1Accounts = runMpJson<Account[]>('account:list');
		expect(book1Accounts.some((a) => a.path === 'In Book 1')).toBe(true);

		// Cleanup
		runMp(`book:delete ${book1.id} --force`);
		runMp(`book:delete ${book2.id} --force`);
	});

	it('fails with helpful error when no books exist', () => {
		// Clear config default
		runMp('config:set defaultBookId ""');

		// Delete all books
		deleteAllBooks();

		// Command should fail with helpful message
		const { stderr, exitCode } = runMp('account:list');
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('No books found');
		expect(stderr).toContain('book:create');
	});
});

describe('Config Commands', () => {
	it('shows current config', () => {
		const config = runMpJson<{ defaultBookId?: string }>('config:show');
		expect(typeof config).toBe('object');
	});

	it('shows config path', () => {
		const { stdout } = runMp('config:path');
		expect(stdout).toContain('.moneypit');
	});

	it('sets and reads config values', () => {
		// Set a value
		runMp('config:set defaultBookId test123');

		// Read it back
		const config = runMpJson<{ defaultBookId?: string }>('config:show');
		expect(config.defaultBookId).toBe('test123');

		// Clear it
		runMp('config:set defaultBookId ""');
	});
});
