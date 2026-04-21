import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Account {
	id: string;
	type: string;
	path: string;
}

interface BalanceRecord {
	id: string;
	accountId: string;
	date: string;
	balance: string;
}

interface Transaction {
	id: string;
	date: string;
	description: string;
	amount: string;
}

// Shared book for all balance record tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Balance Record Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Balance Record CRUD', () => {
	let checkingAccount: Account;
	let expenseAccount: Account;

	beforeAll(() => {
		checkingAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Balance Test Checking"', bookId);
		expenseAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Balance Test:Expenses"', bookId);
	});

	it('creates a balance record', () => {
		const record = runMpJsonWithBook<BalanceRecord>(
			`balance:add --account ${checkingAccount.id} --date 2026-04-01 --balance 1000.00`,
			bookId
		);

		expect(record.id).toBeDefined();
		expect(record.accountId).toBe(checkingAccount.id);
		expect(parseFloat(record.balance)).toBe(1000);
	});

	it('lists balance records for an account', () => {
		// Add another record
		runMpJsonWithBook<BalanceRecord>(
			`balance:add --account ${checkingAccount.id} --date 2026-04-15 --balance 1500.00`,
			bookId
		);

		const records = runMpJsonWithBook<BalanceRecord[]>(`balance:list ${checkingAccount.id}`, bookId);

		expect(records.length).toBeGreaterThanOrEqual(2);
		// Should be sorted by date descending
		expect(new Date(records[0].date) >= new Date(records[1].date)).toBe(true);
	});

	it('updates a balance record on same date (upsert)', () => {
		// Add a record for the same date - should update
		const updated = runMpJsonWithBook<BalanceRecord>(
			`balance:add --account ${checkingAccount.id} --date 2026-04-01 --balance 1100.00`,
			bookId
		);

		expect(parseFloat(updated.balance)).toBe(1100);

		// Verify only one record exists for that date
		const records = runMpJsonWithBook<BalanceRecord[]>(`balance:list ${checkingAccount.id}`, bookId);
		const april1Records = records.filter((r) => r.date.startsWith('2026-04-01'));
		expect(april1Records.length).toBe(1);
	});

	it('deletes a balance record', () => {
		const record = runMpJsonWithBook<BalanceRecord>(
			`balance:add --account ${checkingAccount.id} --date 2026-04-20 --balance 2000.00`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:delete ${record.id}`, bookId);
		expect(stdout).toContain('Deleted balance record');

		// Verify it's gone
		const records = runMpJsonWithBook<BalanceRecord[]>(`balance:list ${checkingAccount.id}`, bookId);
		expect(records.find((r) => r.id === record.id)).toBeUndefined();
	});

	it('rejects balance records for non-asset/liability accounts', () => {
		const { exitCode, stderr } = runMpWithBook(
			`balance:add --account ${expenseAccount.id} --date 2026-04-01 --balance 500.00`,
			bookId
		);

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('Asset or Liability');
	});
});

describe('Balance Calculation', () => {
	let bankAccount: Account;
	let groceriesAccount: Account;
	let incomeAccount: Account;

	beforeAll(() => {
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Calc Test Bank"', bookId);
		groceriesAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Calc Test:Groceries"', bookId);
		incomeAccount = runMpJsonWithBook<Account>('account:create --type income --path "Calc Test:Salary"', bookId);
	});

	it('calculates balance with no transactions', () => {
		const { stdout } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);

		expect(stdout).toContain('$0.00');
	});

	it('calculates balance with opening balance', () => {
		// Set opening balance
		runMpJsonWithBook<Account>(`account:update ${bankAccount.id} --opening-balance 5000`, bookId);

		const { stdout } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);

		expect(stdout).toContain('$5000.00');
	});

	it('calculates balance after deposits (credits to bank)', () => {
		// Deposit: debit bank (increase), credit income (source)
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Paycheck" --amount 2000.00 --debit ${bankAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);

		// Opening 5000 + 2000 deposit = 7000
		expect(stdout).toContain('$7000.00');
	});

	it('calculates balance after withdrawals (debits from bank)', () => {
		// Expense: debit groceries (expense), credit bank (decrease)
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-02 --description "Grocery Store" --amount 150.00 --debit ${groceriesAccount.id} --credit ${bankAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);

		// 7000 - 150 = 6850
		expect(stdout).toContain('$6850.00');
	});

	it('calculates balance as of a specific date', () => {
		// Add future transaction
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-10 --description "Future Expense" --amount 500.00 --debit ${groceriesAccount.id} --credit ${bankAccount.id}`,
			bookId
		);

		// Check balance as of April 5 (before the future transaction)
		const { stdout: april5 } = runMpWithBook(`balance:check ${bankAccount.id} --date 2026-04-05`, bookId);
		expect(april5).toContain('$6850.00');

		// Check current balance (includes future transaction)
		const { stdout: current } = runMpWithBook(`balance:check ${bankAccount.id}`, bookId);
		expect(current).toContain('$6350.00');
	});

	it('handles multiple transactions on same day', () => {
		const freshAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Multi TX Test"', bookId);
		runMpJsonWithBook<Account>(`account:update ${freshAccount.id} --opening-balance 1000`, bookId);

		// Multiple transactions on same day
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Purchase 1" --amount 100.00 --debit ${groceriesAccount.id} --credit ${freshAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Purchase 2" --amount 50.00 --debit ${groceriesAccount.id} --credit ${freshAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Deposit" --amount 200.00 --debit ${freshAccount.id} --credit ${incomeAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${freshAccount.id}`, bookId);

		// 1000 - 100 - 50 + 200 = 1050
		expect(stdout).toContain('$1050.00');
	});
});

describe('Liability Balance Calculation', () => {
	let creditCard: Account;
	let expenseAccount: Account;
	let bankAccount: Account;

	beforeAll(() => {
		creditCard = runMpJsonWithBook<Account>('account:create --type liability --path "Liability Test CC"', bookId);
		expenseAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Liability Test:Shopping"', bookId);
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Liability Test Bank"', bookId);
	});

	it('tracks credit card charges', () => {
		// Charge: debit expense (where money went), credit card (liability increases)
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Amazon Purchase" --amount 250.00 --debit ${expenseAccount.id} --credit ${creditCard.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${creditCard.id}`, bookId);

		// Liability balance is negative (we owe money)
		// Credit to liability = -250
		expect(stdout).toContain('$-250.00');
	});

	it('tracks credit card payments', () => {
		// Payment: debit credit card (liability decreases), credit bank (asset decreases)
		runMpJsonWithBook<Account>(`account:update ${bankAccount.id} --opening-balance 1000`, bookId);

		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-05 --description "CC Payment" --amount 100.00 --debit ${creditCard.id} --credit ${bankAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`balance:check ${creditCard.id}`, bookId);

		// -250 + 100 = -150
		expect(stdout).toContain('$-150.00');
	});

	it('can add balance records to liability accounts', () => {
		const record = runMpJsonWithBook<BalanceRecord>(
			`balance:add --account ${creditCard.id} --date 2026-04-30 --balance -150.00`,
			bookId
		);

		expect(record.accountId).toBe(creditCard.id);
		expect(parseFloat(record.balance)).toBe(-150);
	});
});
