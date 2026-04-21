import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

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
}

// Shared book for all running balance tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Running Balance Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

/**
 * Tests for running balance calculation with pagination.
 *
 * This test verifies that running balances are calculated correctly using
 * SQL window functions, especially across pagination boundaries.
 */
describe('Running Balance Calculation', () => {
	let bankAccount: Account;
	let expenseAccount: Account;
	let incomeAccount: Account;
	const txIds: string[] = [];

	beforeAll(() => {
		// Create fresh accounts for testing
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Running Balance Test Bank"', bookId);
		expenseAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Running Balance Test:Expenses"', bookId);
		incomeAccount = runMpJsonWithBook<Account>('account:create --type income --path "Running Balance Test:Income"', bookId);

		// Set opening balance
		runMpJsonWithBook<Account>(`account:update ${bankAccount.id} --opening-balance 1000`, bookId);

		// Create a series of transactions with known amounts
		// Day 1: +500 deposit
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-01 --description "Deposit 1" --amount 500.00 --debit ${bankAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);
		txIds.push(tx1.id);

		// Day 2: -100 expense
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-02 --description "Expense 1" --amount 100.00 --debit ${expenseAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		txIds.push(tx2.id);

		// Day 3: +200 deposit
		const tx3 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-03 --description "Deposit 2" --amount 200.00 --debit ${bankAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);
		txIds.push(tx3.id);

		// Day 4: -50 expense
		const tx4 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-04 --description "Expense 2" --amount 50.00 --debit ${expenseAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		txIds.push(tx4.id);

		// Day 5: +300 deposit
		const tx5 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-05 --description "Deposit 3" --amount 300.00 --debit ${bankAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);
		txIds.push(tx5.id);
	});

	it('calculates correct final balance', () => {
		// Opening: 1000
		// +500 = 1500
		// -100 = 1400
		// +200 = 1600
		// -50 = 1550
		// +300 = 1850
		const { stdout } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);
		expect(stdout).toContain('$1850.00');
	});

	it('calculates correct balance at each point in time', () => {
		// Check balance as of each day
		const balanceDay1 = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-01-01`, bookId);
		expect(balanceDay1.stdout).toContain('$1500.00'); // 1000 + 500

		const balanceDay2 = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-01-02`, bookId);
		expect(balanceDay2.stdout).toContain('$1400.00'); // 1500 - 100

		const balanceDay3 = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-01-03`, bookId);
		expect(balanceDay3.stdout).toContain('$1600.00'); // 1400 + 200

		const balanceDay4 = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-01-04`, bookId);
		expect(balanceDay4.stdout).toContain('$1550.00'); // 1600 - 50

		const balanceDay5 = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-01-05`, bookId);
		expect(balanceDay5.stdout).toContain('$1850.00'); // 1550 + 300
	});

	it('calculates running balance correctly with multiple transactions per day', () => {
		// Create account for this test
		const multiTxAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Multi TX Balance Test"', bookId);
		runMpJsonWithBook<Account>(`account:update ${multiTxAccount.id} --opening-balance 500`, bookId);

		// Three transactions on the same day
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-01 --description "Multi 1" --amount 100.00 --debit ${multiTxAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);

		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-01 --description "Multi 2" --amount 50.00 --debit ${expenseAccount.id} --credit ${multiTxAccount.id}`,
			bookId
		);

		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-01 --description "Multi 3" --amount 25.00 --debit ${multiTxAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);

		// Expected: 500 + 100 - 50 + 25 = 575
		const { stdout } = runMpWithBook(`balance:check ${multiTxAccount.id}`, bookId);
		expect(stdout).toContain('$575.00');
	});

	it('handles zero opening balance correctly', () => {
		const zeroAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Zero Balance Test"', bookId);
		// No opening balance set (defaults to 0/null)

		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-03-01 --description "First Deposit" --amount 250.00 --debit ${zeroAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${zeroAccount.id}`, bookId);
		expect(stdout).toContain('$250.00');
	});

	it('excludes merged transactions from balance calculation', () => {
		// Create accounts for merge test
		const mergeAccount1 = runMpJsonWithBook<Account>('account:create --type asset --path "Merge Balance Test 1"', bookId);
		const mergeAccount2 = runMpJsonWithBook<Account>('account:create --type asset --path "Merge Balance Test 2"', bookId);
		runMpJsonWithBook<Account>(`account:update ${mergeAccount1.id} --opening-balance 1000`, bookId);

		// Create two transactions that represent the same transfer
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Transfer Out" --amount 200.00 --credit ${mergeAccount1.id}`,
			bookId
		);
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Transfer In" --amount 200.00 --debit ${mergeAccount2.id}`,
			bookId
		);

		// Before merge: balance should be 1000 - 200 = 800
		const beforeMerge = runMpWithBook(`balance:check ${mergeAccount1.id}`, bookId);
		expect(beforeMerge.stdout).toContain('$800.00');

		// Merge the transactions
		runMpWithBook(`tx:merge ${tx1.id} ${tx2.id}`, bookId);

		// After merge: balance should still be 800 (merged tx excluded, survivor has both sides)
		const afterMerge = runMpWithBook(`balance:check ${mergeAccount1.id}`, bookId);
		expect(afterMerge.stdout).toContain('$800.00');
	});
});
