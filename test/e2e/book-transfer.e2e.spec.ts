import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMp, runMpJson, createTestBook, deleteTestBook, resetTestBookId } from './setup';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
	openingBalance: string | null;
	taxCategoryId: string | null;
}

interface Transaction {
	id: string;
	date: string;
	description: string;
	amount: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
	status: string;
}

interface Rule {
	id: string;
	pattern: string;
	accountId: string;
	isRegex: boolean;
}

interface TaxCategory {
	id: string;
	name: string;
	scheduleRef: string | null;
}

interface BookExport {
	version: number;
	exportedAt: string;
	book: {
		name: string;
		description: string | null;
		isDemo: boolean;
	};
	accounts: Array<{ id: string; path: string; type: string }>;
	transactions: Array<{ id: string; description: string }>;
	rules: Array<{ id: string; pattern: string }>;
	taxCategories: Array<{ id: string; name: string }>;
	balanceRecords: Array<{ id: string }>;
	dismissedDuplicates: Array<{ tx1Id: string; tx2Id: string }>;
	enabledModules: string[];
}

describe('Book Export/Import', () => {
	let sourceBookId: string;
	let tempDir: string;
	let exportPath: string;

	beforeAll(() => {
		sourceBookId = createTestBook('Export Test Source');
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneypit-test-'));
		exportPath = path.join(tempDir, 'export.json');
	});

	afterAll(() => {
		deleteTestBook(sourceBookId);
		resetTestBookId();
		// Clean up temp files
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe('Export', () => {
		it('exports an empty book', () => {
			const { stdout, exitCode } = runMp(`--book ${sourceBookId} book:export ${exportPath}`);
			expect(exitCode).toBe(0);
			expect(stdout).toContain('Exported book');

			const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as BookExport;
			expect(exported.version).toBe(1);
			expect(exported.book.name).toBe('Export Test Source');
			expect(exported.accounts).toEqual([]);
			expect(exported.transactions).toEqual([]);
		});

		it('exports accounts', () => {
			// Create some accounts
			runMpJson<Account>(`--book ${sourceBookId} account:create --type asset --path "Checking"`);
			runMpJson<Account>(`--book ${sourceBookId} account:create --type expense --path "Groceries"`);

			runMp(`--book ${sourceBookId} book:export ${exportPath}`);
			const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as BookExport;

			expect(exported.accounts.length).toBe(2);
			expect(exported.accounts.some((a) => a.path === 'Checking')).toBe(true);
			expect(exported.accounts.some((a) => a.path === 'Groceries')).toBe(true);
		});

		it('exports transactions', () => {
			const accounts = runMpJson<Account[]>(`--book ${sourceBookId} account:list`);
			const checking = accounts.find((a) => a.path === 'Checking')!;
			const groceries = accounts.find((a) => a.path === 'Groceries')!;

			// Create a categorized transaction
			runMpJson(
				`--book ${sourceBookId} tx:create --date 2026-04-01 --description "Test Transaction" --amount 50.00 --credit ${checking.id} --debit ${groceries.id}`
			);

			runMp(`--book ${sourceBookId} book:export ${exportPath}`);
			const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as BookExport;

			expect(exported.transactions.length).toBe(1);
			expect(exported.transactions[0].description).toBe('Test Transaction');
		});

		it('exports rules', () => {
			const accounts = runMpJson<Account[]>(`--book ${sourceBookId} account:list --type expense`);
			const groceries = accounts.find((a) => a.path === 'Groceries')!;

			runMpJson(`--book ${sourceBookId} rule:create "WHOLE FOODS" --account ${groceries.id}`);

			runMp(`--book ${sourceBookId} book:export ${exportPath}`);
			const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as BookExport;

			expect(exported.rules.length).toBe(1);
			expect(exported.rules[0].pattern).toBe('WHOLE FOODS');
		});

		it('exports tax categories', () => {
			runMpJson(`--book ${sourceBookId} tax:create "Business Expense" --schedule "Schedule C"`);

			runMp(`--book ${sourceBookId} book:export ${exportPath}`);
			const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as BookExport;

			expect(exported.taxCategories.length).toBe(1);
			expect(exported.taxCategories[0].name).toBe('Business Expense');
		});
	});

	describe('Import', () => {
		let importedBookId: string | null = null;

		afterAll(() => {
			if (importedBookId) {
				runMp(`book:delete ${importedBookId} --force`);
			}
		});

		it('imports a book with default name', () => {
			const { stdout, exitCode } = runMp(`book:import ${exportPath}`);
			expect(exitCode).toBe(0);
			expect(stdout).toContain('Imported book');
			expect(stdout).toContain('Export Test Source (imported)');

			// Extract book ID from output - format is "BookName (bookId)"
			// The book ID is a cuid that starts with 'c' and contains lowercase letters and numbers
			const match = stdout.match(/\(([a-z][a-z0-9]{20,})\)/);
			importedBookId = match ? match[1] : null;
			expect(importedBookId).toBeTruthy();
		});

		it('imported book has correct data', () => {
			expect(importedBookId).toBeTruthy();

			// Check accounts
			const accounts = runMpJson<Account[]>(`--book ${importedBookId} account:list`);
			expect(accounts.length).toBe(2);
			expect(accounts.some((a) => a.path === 'Checking')).toBe(true);
			expect(accounts.some((a) => a.path === 'Groceries')).toBe(true);

			// Check transactions
			const transactions = runMpJson<Transaction[]>(`--book ${importedBookId} tx:list`);
			expect(transactions.length).toBe(1);
			expect(transactions[0].description).toBe('Test Transaction');

			// Check rules
			const rules = runMpJson<Rule[]>(`--book ${importedBookId} rule:list`);
			expect(rules.length).toBe(1);
			expect(rules[0].pattern).toBe('WHOLE FOODS');

			// Check tax categories
			const taxCategories = runMpJson<TaxCategory[]>(`--book ${importedBookId} tax:list`);
			expect(taxCategories.length).toBe(1);
			expect(taxCategories[0].name).toBe('Business Expense');
		});

		it('imported transactions reference correct accounts', () => {
			expect(importedBookId).toBeTruthy();

			const accounts = runMpJson<Account[]>(`--book ${importedBookId} account:list`);
			const transactions = runMpJson<Transaction[]>(`--book ${importedBookId} tx:list`);

			const tx = transactions[0];
			const checking = accounts.find((a) => a.path === 'Checking')!;
			const groceries = accounts.find((a) => a.path === 'Groceries')!;

			// Transaction should reference the NEW account IDs, not the old ones
			expect(tx.creditAccountId).toBe(checking.id);
			expect(tx.debitAccountId).toBe(groceries.id);
		});

		it('imported rules reference correct accounts', () => {
			expect(importedBookId).toBeTruthy();

			const accounts = runMpJson<Account[]>(`--book ${importedBookId} account:list --type expense`);
			const rules = runMpJson<Rule[]>(`--book ${importedBookId} rule:list`);

			const groceries = accounts.find((a) => a.path === 'Groceries')!;
			expect(rules[0].accountId).toBe(groceries.id);
		});
	});

	describe('Import with custom name', () => {
		let customNameBookId: string | null = null;

		afterAll(() => {
			if (customNameBookId) {
				runMp(`book:delete ${customNameBookId} --force`);
			}
		});

		it('imports with custom name', () => {
			const { stdout, exitCode } = runMp(`book:import ${exportPath} --name "Custom Import Name"`);
			expect(exitCode).toBe(0);
			expect(stdout).toContain('Custom Import Name');

			const match = stdout.match(/\(([a-z][a-z0-9]{20,})\)/);
			customNameBookId = match ? match[1] : null;

			const book = runMpJson<Book>(`book:get ${customNameBookId}`);
			expect(book.name).toBe('Custom Import Name');
		});
	});

	describe('Import validation', () => {
		it('rejects invalid export data', () => {
			const invalidPath = path.join(tempDir, 'invalid.json');
			fs.writeFileSync(invalidPath, JSON.stringify({ foo: 'bar' }));

			const { stderr, exitCode } = runMp(`book:import ${invalidPath}`);
			expect(exitCode).not.toBe(0);
			expect(stderr).toContain('Unsupported export version');
		});

		it('rejects duplicate book name', () => {
			// First import should succeed
			const firstImportPath = path.join(tempDir, 'first.json');
			fs.writeFileSync(
				firstImportPath,
				JSON.stringify({
					version: 1,
					exportedAt: new Date().toISOString(),
					book: { name: 'Duplicate Name Test', description: null, isDemo: false },
					accounts: [],
					transactions: [],
					rules: [],
					taxCategories: [],
					balanceRecords: [],
					dismissedDuplicates: [],
					enabledModules: []
				})
			);

			const { exitCode: firstCode } = runMp(`book:import ${firstImportPath}`);
			expect(firstCode).toBe(0);

			// Second import with same name should fail
			const { stderr, exitCode } = runMp(`book:import ${firstImportPath}`);
			expect(exitCode).not.toBe(0);
			expect(stderr).toContain('already exists');

			// Cleanup - find the book with "(imported)" suffix
			const books = runMp('book:list');
			const match = books.stdout.match(/([a-z][a-z0-9]{20,})\s+Duplicate Name Test \(imported\)/);
			if (match) {
				runMp(`book:delete ${match[1]} --force`);
			}
		});

		it('rejects non-existent file', () => {
			const { stderr, exitCode } = runMp('book:import /nonexistent/path.json');
			expect(exitCode).not.toBe(0);
			expect(stderr).toContain('File not found');
		});
	});
});

describe('Round-trip integrity', () => {
	let bookId: string;
	let importedBookId: string | null = null;
	let tempDir: string;
	let exportPath: string;

	beforeAll(() => {
		bookId = createTestBook('Round Trip Test');
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneypit-roundtrip-'));
		exportPath = path.join(tempDir, 'roundtrip.json');

		// Set up comprehensive test data
		// Create accounts
		const checking = runMpJson<Account>(`--book ${bookId} account:create --type asset --path "Checking"`);
		const savings = runMpJson<Account>(`--book ${bookId} account:create --type asset --path "Savings"`);
		const groceries = runMpJson<Account>(`--book ${bookId} account:create --type expense --path "Groceries"`);
		const utilities = runMpJson<Account>(`--book ${bookId} account:create --type expense --path "Utilities"`);
		const salary = runMpJson<Account>(`--book ${bookId} account:create --type income --path "Salary"`);

		// Update account with opening balance
		runMp(`--book ${bookId} account:update ${checking.id} --opening-balance 1000.00`);

		// Create tax category and link to account
		const taxCat = runMpJson<TaxCategory>(`--book ${bookId} tax:create "Deductible" --schedule "Schedule A"`);
		runMp(`--book ${bookId} account:update ${groceries.id} --tax-category ${taxCat.id}`);

		// Create transactions
		runMpJson(
			`--book ${bookId} tx:create --date 2026-04-01 --description "Paycheck" --amount 3000.00 --debit ${checking.id} --credit ${salary.id}`
		);
		runMpJson(
			`--book ${bookId} tx:create --date 2026-04-02 --description "Grocery Shopping" --amount 150.00 --credit ${checking.id} --debit ${groceries.id}`
		);
		runMpJson(
			`--book ${bookId} tx:create --date 2026-04-03 --description "Electric Bill" --amount 100.00 --credit ${checking.id} --debit ${utilities.id}`
		);
		runMpJson(
			`--book ${bookId} tx:create --date 2026-04-04 --description "Transfer to Savings" --amount 500.00 --credit ${checking.id} --debit ${savings.id}`
		);

		// Create rules
		runMpJson(`--book ${bookId} rule:create "GROCERY" --account ${groceries.id}`);
		runMpJson(`--book ${bookId} rule:create "ELECTRIC" --account ${utilities.id} --regex`);

		// Add balance record
		runMp(`--book ${bookId} balance:add --account ${checking.id} --date 2026-04-01 --balance 1000.00`);
	});

	afterAll(() => {
		deleteTestBook(bookId);
		if (importedBookId) {
			runMp(`book:delete ${importedBookId} --force`);
		}
		resetTestBookId();
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('preserves all data after export and import', () => {
		// Export
		runMp(`--book ${bookId} book:export ${exportPath}`);

		// Import
		const { stdout } = runMp(`book:import ${exportPath} --name "Round Trip Import"`);
		const match = stdout.match(/\(([a-z][a-z0-9]{20,})\)/);
		importedBookId = match ? match[1] : null;
		expect(importedBookId).toBeTruthy();

		// Compare accounts
		const origAccounts = runMpJson<Account[]>(`--book ${bookId} account:list`);
		const newAccounts = runMpJson<Account[]>(`--book ${importedBookId} account:list`);
		expect(newAccounts.length).toBe(origAccounts.length);

		// Check opening balance was preserved
		const origChecking = origAccounts.find((a) => a.path === 'Checking')!;
		const newChecking = newAccounts.find((a) => a.path === 'Checking')!;
		expect(newChecking.openingBalance).toBe(origChecking.openingBalance);

		// Check tax category link was preserved
		const origGroceries = origAccounts.find((a) => a.path === 'Groceries')!;
		const newGroceries = newAccounts.find((a) => a.path === 'Groceries')!;
		expect(origGroceries.taxCategoryId).toBeTruthy();
		expect(newGroceries.taxCategoryId).toBeTruthy();
		// IDs will be different but both should have a tax category

		// Compare transactions
		const origTxs = runMpJson<Transaction[]>(`--book ${bookId} tx:list`);
		const newTxs = runMpJson<Transaction[]>(`--book ${importedBookId} tx:list`);
		expect(newTxs.length).toBe(origTxs.length);

		// Verify transaction descriptions match
		const origDescriptions = origTxs.map((t) => t.description).sort();
		const newDescriptions = newTxs.map((t) => t.description).sort();
		expect(newDescriptions).toEqual(origDescriptions);

		// Compare rules
		const origRules = runMpJson<Rule[]>(`--book ${bookId} rule:list`);
		const newRules = runMpJson<Rule[]>(`--book ${importedBookId} rule:list`);
		expect(newRules.length).toBe(origRules.length);

		const origPatterns = origRules.map((r) => r.pattern).sort();
		const newPatterns = newRules.map((r) => r.pattern).sort();
		expect(newPatterns).toEqual(origPatterns);

		// Compare tax categories
		const origTaxCats = runMpJson<TaxCategory[]>(`--book ${bookId} tax:list`);
		const newTaxCats = runMpJson<TaxCategory[]>(`--book ${importedBookId} tax:list`);
		expect(newTaxCats.length).toBe(origTaxCats.length);
		expect(newTaxCats[0].name).toBe(origTaxCats[0].name);
	});

	it('preserves transaction account references correctly', () => {
		expect(importedBookId).toBeTruthy();

		const accounts = runMpJson<Account[]>(`--book ${importedBookId} account:list`);
		const transactions = runMpJson<Transaction[]>(`--book ${importedBookId} tx:list`);

		const checking = accounts.find((a) => a.path === 'Checking')!;
		const salary = accounts.find((a) => a.path === 'Salary')!;

		// Find the paycheck transaction
		const paycheck = transactions.find((t) => t.description === 'Paycheck')!;
		expect(paycheck.debitAccountId).toBe(checking.id);
		expect(paycheck.creditAccountId).toBe(salary.id);
	});
});
