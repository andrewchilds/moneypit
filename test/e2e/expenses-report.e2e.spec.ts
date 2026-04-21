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
	status: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
}

// Shared book for all expenses report tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Expenses Report Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Expenses Report Data', () => {
	let bankAccount: Account;
	let groceriesAccount: Account;
	let utilitiesElectricAccount: Account;
	let utilitiesGasAccount: Account;
	let entertainmentAccount: Account;

	beforeAll(() => {
		// Create a bank account (asset) to fund expenses
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Expense Report Test Bank"', bookId);

		// Create expense accounts with hierarchical paths
		groceriesAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Food:Groceries"', bookId);
		utilitiesElectricAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Utilities:Electric"', bookId);
		utilitiesGasAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Utilities:Gas"', bookId);
		entertainmentAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Entertainment"', bookId);

		// Create transactions for different months in 2026
		// January transactions
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-15 --description "Grocery Store Jan" --amount 150.00 --debit ${groceriesAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-01-20 --description "Electric Bill Jan" --amount 120.00 --debit ${utilitiesElectricAccount.id} --credit ${bankAccount.id}`,
			bookId
		);

		// February transactions
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-10 --description "Grocery Store Feb" --amount 175.00 --debit ${groceriesAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-15 --description "Gas Bill Feb" --amount 80.00 --debit ${utilitiesGasAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-02-20 --description "Movies" --amount 50.00 --debit ${entertainmentAccount.id} --credit ${bankAccount.id}`,
			bookId
		);

		// March transactions
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-03-05 --description "Grocery Store Mar" --amount 200.00 --debit ${groceriesAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-03-10 --description "Electric Bill Mar" --amount 100.00 --debit ${utilitiesElectricAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-03-15 --description "Gas Bill Mar" --amount 60.00 --debit ${utilitiesGasAccount.id} --credit ${bankAccount.id}`,
			bookId
		);
	});

	it('expense accounts are created with correct paths', () => {
		const expenses = runMpJsonWithBook<Account[]>('account:list --type expense', bookId);

		expect(expenses.some((a) => a.path === 'Food:Groceries')).toBe(true);
		expect(expenses.some((a) => a.path === 'Utilities:Electric')).toBe(true);
		expect(expenses.some((a) => a.path === 'Utilities:Gas')).toBe(true);
		expect(expenses.some((a) => a.path === 'Entertainment')).toBe(true);
	});

	it('expense transactions are recorded correctly', () => {
		// Check transactions for groceries account
		const groceryTxs = runMpJsonWithBook<Transaction[]>(`tx:list --account ${groceriesAccount.id}`, bookId);
		expect(groceryTxs.length).toBe(3);

		// Total should be 150 + 175 + 200 = 525
		const total = groceryTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
		expect(total).toBe(525);
	});

	it('utilities accounts have correct totals', () => {
		// Electric: 120 + 100 = 220
		const electricTxs = runMpJsonWithBook<Transaction[]>(`tx:list --account ${utilitiesElectricAccount.id}`, bookId);
		const electricTotal = electricTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
		expect(electricTotal).toBe(220);

		// Gas: 80 + 60 = 140
		const gasTxs = runMpJsonWithBook<Transaction[]>(`tx:list --account ${utilitiesGasAccount.id}`, bookId);
		const gasTotal = gasTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
		expect(gasTotal).toBe(140);
	});

	it('transactions span multiple months', () => {
		// January
		const janTxs = runMpJsonWithBook<Transaction[]>('tx:list --from 2026-01-01 --to 2026-01-31', bookId);
		const janExpenses = janTxs.filter(
			(tx) => tx.debitAccountId && tx.debitAccountId !== bankAccount.id
		);
		expect(janExpenses.length).toBeGreaterThanOrEqual(2);

		// February
		const febTxs = runMpJsonWithBook<Transaction[]>('tx:list --from 2026-02-01 --to 2026-02-28', bookId);
		const febExpenses = febTxs.filter(
			(tx) => tx.debitAccountId && tx.debitAccountId !== bankAccount.id
		);
		expect(febExpenses.length).toBeGreaterThanOrEqual(3);

		// March
		const marTxs = runMpJsonWithBook<Transaction[]>('tx:list --from 2026-03-01 --to 2026-03-31', bookId);
		const marExpenses = marTxs.filter(
			(tx) => tx.debitAccountId && tx.debitAccountId !== bankAccount.id
		);
		expect(marExpenses.length).toBeGreaterThanOrEqual(3);
	});
});

describe('Expenses Report Category Hierarchy', () => {
	it('hierarchical expense accounts exist', () => {
		const expenses = runMpJsonWithBook<Account[]>('account:list --type expense', bookId);

		// Check for parent:child structure
		const utilitiesAccounts = expenses.filter((a) => a.path.startsWith('Utilities:'));
		expect(utilitiesAccounts.length).toBeGreaterThanOrEqual(2);

		const foodAccounts = expenses.filter((a) => a.path.startsWith('Food:'));
		expect(foodAccounts.length).toBeGreaterThanOrEqual(1);
	});

	it('account tree shows correct structure', () => {
		const { stdout } = runMpWithBook('account:tree --type expense', bookId);

		// Tree should show hierarchical structure
		expect(stdout).toContain('Utilities');
		expect(stdout).toContain('Electric');
		expect(stdout).toContain('Gas');
		expect(stdout).toContain('Food');
		expect(stdout).toContain('Groceries');
		expect(stdout).toContain('Entertainment');
	});
});
