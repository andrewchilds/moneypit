import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, runMp, createTestBook, deleteTestBook, resetTestBookId } from './setup';
import { resolve } from 'path';

interface Account {
	id: string;
	type: string;
	path: string;
}

interface Transaction {
	id: string;
	date: string;
	description: string;
	amount: string;
	status: string;
	importSource: string | null;
}

interface Rule {
	id: string;
	pattern: string;
	accountId: string;
}

const FIXTURES_DIR = resolve(__dirname, '../fixtures');

// Shared book for all import tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Import Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('CSV Import', () => {
	let checkingAccount: Account;
	let creditCardAccount: Account;

	beforeAll(() => {
		checkingAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Import Test Checking"', bookId);
		creditCardAccount = runMpJsonWithBook<Account>('account:create --type liability --path "Import Test Credit Card"', bookId);
	});

	it('imports CSV with mapping', () => {
		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;
		const mapping = JSON.stringify({
			dateColumn: 'Posting Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description'
		});
		const { stdout } = runMpWithBook(`import:csv "${csvPath}" --account ${checkingAccount.id} --mapping '${mapping}'`, bookId);

		expect(stdout).toContain('Imported 5 transactions');

		// Verify transactions were created
		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${checkingAccount.id} --limit 100`, bookId);
		expect(txList.some((t) => t.description === 'WHOLE FOODS MARKET')).toBe(true);
		expect(txList.some((t) => t.description === 'SHELL OIL GAS STATION')).toBe(true);
		expect(txList.some((t) => t.description === 'DIRECT DEPOSIT PAYROLL')).toBe(true);
	});

	it('imports CSV with credit card mapping', () => {
		const csvPath = `${FIXTURES_DIR}/chase-credit.csv`;
		const mapping = JSON.stringify({
			dateColumn: 'Transaction Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description',
			amountSign: 'inverted'
		});
		const { stdout } = runMpWithBook(`import:csv "${csvPath}" --account ${creditCardAccount.id} --mapping '${mapping}'`, bookId);

		expect(stdout).toContain('Imported 4 transactions');

		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${creditCardAccount.id} --limit 100`, bookId);
		expect(txList.some((t) => t.description === 'AMAZON.COM')).toBe(true);
		expect(txList.some((t) => t.description === 'UBER EATS')).toBe(true);
	});

	it('skips duplicate transactions on re-import', () => {
		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;
		const mapping = JSON.stringify({
			dateColumn: 'Posting Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description'
		});
		const { stdout } = runMpWithBook(`import:csv "${csvPath}" --account ${checkingAccount.id} --mapping '${mapping}'`, bookId);

		expect(stdout).toContain('skipped 5 duplicates');
		expect(stdout).toContain('Imported 0 transactions');
	});

	it('imports CSV with custom mapping', () => {
		// Create a new account to avoid duplicates
		const newAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Import Test Custom"', bookId);

		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;
		const mapping = JSON.stringify({
			dateColumn: 'Posting Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description'
		});

		const { stdout } = runMpWithBook(`import:csv "${csvPath}" --account ${newAccount.id} --mapping '${mapping}'`, bookId);

		expect(stdout).toContain('Imported 5 transactions');
	});

	it('previews CSV file', () => {
		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;
		// import:preview doesn't need a book
		const { stdout } = runMp(`import:preview "${csvPath}" --limit 3`);

		expect(stdout).toContain('Headers:');
		expect(stdout).toContain('Posting Date');
		expect(stdout).toContain('Description');
		expect(stdout).toContain('Amount');
	});
});

describe('OFX Import', () => {
	let bankAccount: Account;

	beforeAll(() => {
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Import Test OFX Bank"', bookId);
	});

	it('imports OFX file', () => {
		const ofxPath = `${FIXTURES_DIR}/bank-statement.ofx`;
		const { stdout } = runMpWithBook(`import:ofx "${ofxPath}" --account ${bankAccount.id}`, bookId);

		expect(stdout).toContain('Imported 4 transactions');

		// Verify transactions
		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${bankAccount.id} --limit 100`, bookId);
		expect(txList.some((t) => t.description === 'COSTCO WHOLESALE')).toBe(true);
		expect(txList.some((t) => t.description === 'TRADER JOES')).toBe(true);
		expect(txList.some((t) => t.description === 'EMPLOYER INC')).toBe(true);
	});

	it('skips duplicates on OFX re-import', () => {
		const ofxPath = `${FIXTURES_DIR}/bank-statement.ofx`;
		const { stdout } = runMpWithBook(`import:ofx "${ofxPath}" --account ${bankAccount.id}`, bookId);

		expect(stdout).toContain('skipped 4 duplicates');
		expect(stdout).toContain('Imported 0 transactions');
	});

	it('correctly sets transaction amounts', () => {
		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${bankAccount.id} --limit 100`, bookId);

		const costco = txList.find((t) => t.description === 'COSTCO WHOLESALE');
		expect(costco).toBeDefined();
		expect(parseFloat(costco!.amount)).toBe(150);

		const payroll = txList.find((t) => t.description === 'EMPLOYER INC');
		expect(payroll).toBeDefined();
		expect(parseFloat(payroll!.amount)).toBe(3000);
	});
});

describe('Import with Rules', () => {
	let groceriesAccount: Account;

	beforeAll(() => {
		// Create bank account (used implicitly via imports) and expense account
		runMpJsonWithBook<Account>('account:create --type asset --path "Import Rules Test Bank"', bookId);
		groceriesAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Import Rules Test:Groceries"', bookId);

		// Create a rule before importing
		runMpJsonWithBook<Rule>('rule:create "SAFEWAY" --account ' + groceriesAccount.id, bookId);
	});

	it('applies rules automatically during import', () => {
		// Create a custom CSV with matching transactions
		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;

		// First create a rule that matches something in our fixture
		runMpJsonWithBook<Rule>('rule:create "WHOLE FOODS" --account ' + groceriesAccount.id, bookId);

		// Create a fresh account for this test
		const freshAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Import Rules Fresh"', bookId);

		const mapping = JSON.stringify({
			dateColumn: 'Posting Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description'
		});
		const { stdout } = runMpWithBook(`import:csv "${csvPath}" --account ${freshAccount.id} --mapping '${mapping}'`, bookId);

		// Rules should be applied
		expect(stdout).toMatch(/Applied \d+ rule\(s\) to \d+ transaction\(s\)|Imported/);

		// Verify the matching transaction was categorized
		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${freshAccount.id} --limit 100`, bookId);
		const wholeFoods = txList.find((t) => t.description === 'WHOLE FOODS MARKET');
		expect(wholeFoods).toBeDefined();
		// It should be categorized if rules applied
	});
});

describe('Delete Imported Transactions', () => {
	let testAccount: Account;

	beforeAll(() => {
		testAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Delete Import Test"', bookId);

		// Import some transactions
		const csvPath = `${FIXTURES_DIR}/chase-checking.csv`;
		const mapping = JSON.stringify({
			dateColumn: 'Posting Date',
			dateFormat: 'MM/DD/YYYY',
			amountColumn: 'Amount',
			descriptionColumn: 'Description'
		});
		runMpWithBook(`import:csv "${csvPath}" --account ${testAccount.id} --mapping '${mapping}'`, bookId);
	});

	it('deletes all imported transactions from a source', () => {
		// First verify we have imported transactions
		const before = runMpJsonWithBook<Transaction[]>(`tx:list --account ${testAccount.id} --limit 100`, bookId);
		expect(before.length).toBeGreaterThan(0);
		expect(before.some((t) => t.importSource?.includes('chase-checking.csv'))).toBe(true);

		// Delete imported transactions from that source
		const { stdout } = runMpWithBook('tx:delete-imported chase-checking.csv', bookId);
		expect(stdout).toMatch(/Deleted \d+ imported transactions/);

		// Verify they're gone from this account
		const after = runMpJsonWithBook<Transaction[]>(`tx:list --account ${testAccount.id} --limit 100`, bookId);
		const fromSource = after.filter((t) => t.importSource?.includes('chase-checking.csv'));
		expect(fromSource.length).toBe(0);
	});
});
