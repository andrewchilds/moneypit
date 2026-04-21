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
	debitAccount?: { path: string } | null;
	creditAccount?: { path: string } | null;
}

// Shared book for all transaction tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Transaction Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Transaction CRUD', () => {
	let checkingAccount: Account;
	let groceriesAccount: Account;

	beforeAll(() => {
		// Create accounts for transaction tests
		checkingAccount = runMpJsonWithBook<Account>('account:create --type asset --path "TX Test Checking"', bookId);
		groceriesAccount = runMpJsonWithBook<Account>('account:create --type expense --path "TX Test:Groceries"', bookId);
	});

	it('creates a fully categorized transaction', () => {
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Grocery Store" --amount 50.00 --debit ${groceriesAccount.id} --credit ${checkingAccount.id}`,
			bookId
		);

		expect(tx.id).toBeDefined();
		expect(tx.description).toBe('Grocery Store');
		expect(parseFloat(tx.amount)).toBe(50);
		expect(tx.debitAccountId).toBe(groceriesAccount.id);
		expect(tx.creditAccountId).toBe(checkingAccount.id);
		// Note: tx:create defaults to PENDING status even with both accounts set
		// Use tx:update to set status to CATEGORIZED if needed
		expect(tx.status).toBe('PENDING');
	});

	it('creates a pending transaction (debit only)', () => {
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-02 --description "Pending Debit" --amount 25.00 --debit ${groceriesAccount.id}`,
			bookId
		);

		expect(tx.status).toBe('PENDING');
		expect(tx.debitAccountId).toBe(groceriesAccount.id);
		expect(tx.creditAccountId).toBeNull();
	});

	it('creates a pending transaction (credit only)', () => {
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-03 --description "Pending Credit" --amount 100.00 --credit ${checkingAccount.id}`,
			bookId
		);

		expect(tx.status).toBe('PENDING');
		expect(tx.debitAccountId).toBeNull();
		expect(tx.creditAccountId).toBe(checkingAccount.id);
	});

	it('lists transactions', () => {
		const txList = runMpJsonWithBook<Transaction[]>('tx:list --limit 100', bookId);

		expect(txList.length).toBeGreaterThanOrEqual(3);
		expect(txList.some((t) => t.description === 'Grocery Store')).toBe(true);
	});

	it('filters transactions by account', () => {
		const txList = runMpJsonWithBook<Transaction[]>(`tx:list --account ${checkingAccount.id}`, bookId);

		expect(txList.length).toBeGreaterThanOrEqual(2);
		expect(
			txList.every((t) => t.debitAccountId === checkingAccount.id || t.creditAccountId === checkingAccount.id)
		).toBe(true);
	});

	it('filters transactions by status', () => {
		const pending = runMpJsonWithBook<Transaction[]>('tx:list --status pending --limit 100', bookId);

		expect(pending.every((t) => t.status === 'PENDING')).toBe(true);
		expect(pending.some((t) => t.description === 'Pending Debit')).toBe(true);
	});

	it('filters transactions by date range', () => {
		const txList = runMpJsonWithBook<Transaction[]>('tx:list --from 2026-04-01 --to 2026-04-02', bookId);

		expect(txList.length).toBeGreaterThanOrEqual(1);
		for (const tx of txList) {
			const date = new Date(tx.date);
			expect(date >= new Date('2026-04-01')).toBe(true);
			expect(date <= new Date('2026-04-02T23:59:59')).toBe(true);
		}
	});

	it('searches transactions by description', () => {
		const txList = runMpJsonWithBook<Transaction[]>('tx:list --search "Grocery"', bookId);

		expect(txList.length).toBeGreaterThanOrEqual(1);
		expect(txList.some((t) => t.description.includes('Grocery'))).toBe(true);
	});

	it('gets a single transaction', () => {
		const txList = runMpJsonWithBook<Transaction[]>('tx:list --search "Grocery Store"', bookId);
		const target = txList.find((t) => t.description === 'Grocery Store');

		const tx = runMpJsonWithBook<Transaction>(`tx:get ${target!.id}`, bookId);

		expect(tx.description).toBe('Grocery Store');
		expect(tx.debitAccount?.path).toBe('TX Test:Groceries');
		expect(tx.creditAccount?.path).toBe('TX Test Checking');
	});

	it('updates a transaction', () => {
		const txList = runMpJsonWithBook<Transaction[]>('tx:list --search "Grocery Store"', bookId);
		const target = txList.find((t) => t.description === 'Grocery Store');

		const updated = runMpJsonWithBook<Transaction>(
			`tx:update ${target!.id} --description "Updated Grocery Store" --amount 55.00`,
			bookId
		);

		expect(updated.description).toBe('Updated Grocery Store');
		expect(parseFloat(updated.amount)).toBe(55);
	});

	it('deletes a transaction', () => {
		const temp = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-10 --description "To Delete TX" --amount 10.00 --credit ${checkingAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook(`tx:delete ${temp.id}`, bookId);
		expect(stdout).toContain('Deleted transaction');

		const { exitCode } = runMpWithBook(`tx:get ${temp.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});
});

describe('Transaction Categorization', () => {
	let bankAccount: Account;
	let rentExpense: Account;
	let utilityExpense: Account;

	beforeAll(() => {
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Cat Test Bank"', bookId);
		rentExpense = runMpJsonWithBook<Account>('account:create --type expense --path "Cat Test:Rent"', bookId);
		utilityExpense = runMpJsonWithBook<Account>('account:create --type expense --path "Cat Test:Utilities"', bookId);
	});

	it('categorizes a single pending transaction with debit', () => {
		// Create a pending transaction with only credit side
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-05 --description "Rent Payment" --amount 1500.00 --credit ${bankAccount.id}`,
			bookId
		);
		expect(tx.status).toBe('PENDING');

		// Categorize by setting the debit side
		const { stdout } = runMpWithBook(`tx:categorize ${tx.id} --debit ${rentExpense.id}`, bookId);
		expect(stdout).toContain('Categorized 1 transaction');

		// Verify it's now categorized
		const updated = runMpJsonWithBook<Transaction>(`tx:get ${tx.id}`, bookId);
		expect(updated.status).toBe('CATEGORIZED');
		expect(updated.debitAccountId).toBe(rentExpense.id);
	});

	it('categorizes multiple transactions at once', () => {
		// Create multiple pending transactions
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-06 --description "Electric Bill" --amount 100.00 --credit ${bankAccount.id}`,
			bookId
		);
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-07 --description "Gas Bill" --amount 75.00 --credit ${bankAccount.id}`,
			bookId
		);

		// Categorize both at once
		const { stdout } = runMpWithBook(`tx:categorize ${tx1.id} ${tx2.id} --debit ${utilityExpense.id}`, bookId);
		expect(stdout).toContain('Categorized 2 transactions');

		// Verify both are categorized
		const updated1 = runMpJsonWithBook<Transaction>(`tx:get ${tx1.id}`, bookId);
		const updated2 = runMpJsonWithBook<Transaction>(`tx:get ${tx2.id}`, bookId);
		expect(updated1.status).toBe('CATEGORIZED');
		expect(updated2.status).toBe('CATEGORIZED');
	});

	it('lists uncategorized transactions', () => {
		// Create an uncategorized transaction
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-08 --description "Unknown Expense" --amount 50.00 --credit ${bankAccount.id}`,
			bookId
		);

		const uncategorized = runMpJsonWithBook<Transaction[]>('tx:uncategorized --limit 100', bookId);

		expect(uncategorized.length).toBeGreaterThanOrEqual(1);
		expect(uncategorized.some((t) => t.description === 'Unknown Expense')).toBe(true);
		expect(uncategorized.every((t) => t.status === 'PENDING')).toBe(true);
	});

	it('filters uncategorized by account', () => {
		const uncategorized = runMpJsonWithBook<Transaction[]>(`tx:uncategorized --account ${bankAccount.id}`, bookId);

		expect(
			uncategorized.every(
				(t) => t.debitAccountId === bankAccount.id || t.creditAccountId === bankAccount.id
			)
		).toBe(true);
	});
});

describe('Transaction Merge/Unmerge', () => {
	let account1: Account;
	let account2: Account;

	beforeAll(() => {
		account1 = runMpJsonWithBook<Account>('account:create --type asset --path "Merge Test Bank"', bookId);
		account2 = runMpJsonWithBook<Account>('account:create --type asset --path "Merge Test Credit Card"', bookId);
	});

	it('merges two transfer transactions', () => {
		// Create two transactions representing the same transfer from different account perspectives
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-10 --description "Transfer Out" --amount 500.00 --credit ${account1.id}`,
			bookId
		);
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-10 --description "Transfer In" --amount 500.00 --debit ${account2.id}`,
			bookId
		);

		// Merge them
		const { stdout } = runMpWithBook(`tx:merge ${tx1.id} ${tx2.id}`, bookId);
		expect(stdout).toContain('Merged transaction');

		// One should be merged into the other
		// The second transaction should now be gone or marked merged
		const survivor = runMpJsonWithBook<Transaction>(`tx:get ${tx1.id}`, bookId);
		expect(survivor.creditAccountId).toBe(account1.id);
		expect(survivor.debitAccountId).toBe(account2.id);
		expect(survivor.status).toBe('CATEGORIZED');
	});

	it('unmerges a previously merged transaction', () => {
		// Create and merge transactions
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-11 --description "To Unmerge Out" --amount 200.00 --credit ${account1.id}`,
			bookId
		);
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-11 --description "To Unmerge In" --amount 200.00 --debit ${account2.id}`,
			bookId
		);

		// Merge returns info about which tx survived and which was merged
		const { stdout: mergeOut } = runMpWithBook(`tx:merge ${tx1.id} ${tx2.id}`, bookId);

		// Parse out which transaction was merged (absorbed) vs survived
		// The merged tx ID is what we need to pass to unmerge
		const mergedMatch = mergeOut.match(/Merged transaction (\S+) into (\S+)/);
		expect(mergedMatch).not.toBeNull();
		const mergedId = mergedMatch![1];
		const survivorId = mergedMatch![2];

		// Now unmerge using the merged transaction's ID
		const { stdout } = runMpWithBook(`tx:unmerge ${mergedId}`, bookId);
		expect(stdout).toContain('Unmerged transaction');

		// Both transactions should now be accessible again
		const survivor = runMpJsonWithBook<Transaction>(`tx:get ${survivorId}`, bookId);
		expect(survivor).toBeDefined();
	});
});
