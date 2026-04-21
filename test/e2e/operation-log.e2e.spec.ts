import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Account {
	id: string;
	type: string;
	path: string;
}

interface Transaction {
	id: string;
	description: string;
	amount: string;
	status: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
}

interface Rule {
	id: string;
	pattern: string;
	accountId: string;
}

interface OperationLog {
	id: string;
	operation: string;
	description: string;
	createdAt: string;
	undoneAt: string | null;
	changes: Array<{
		entityType: string;
		entityId: string;
		before: Record<string, unknown> | null;
		after: Record<string, unknown> | null;
	}>;
}

// Shared book for all operation log tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Operation Log Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Operation Log', () => {
	let testAccount: Account;

	beforeAll(() => {
		testAccount = runMpJsonWithBook<Account>('account:create --type expense --path "OpLog Test:Expenses"', bookId);
	});

	it('logs account creation', () => {
		runMpWithBook('account:create --type asset --path "OpLog Created Account"', bookId);

		// Use a higher limit since tests run in parallel and many operations may be logged
		const { stdout } = runMpWithBook('log:list --limit 20', bookId);

		expect(stdout).toContain('CREATE');
		expect(stdout).toContain('OpLog Created Account');
	});

	it('logs transaction creation', () => {
		const bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "OpLog Bank"', bookId);

		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Logged Transaction" --amount 100.00 --credit ${bankAccount.id}`,
			bookId
		);

		const { stdout } = runMpWithBook('log:list --limit 20', bookId);

		expect(stdout).toContain('CREATE');
		expect(stdout).toContain('Logged Transaction');
	});

	it('logs rule creation', () => {
		runMpJsonWithBook<Rule>(`rule:create "OPLOG TEST PATTERN" --account ${testAccount.id}`, bookId);

		const { stdout } = runMpWithBook('log:list --limit 20', bookId);

		expect(stdout).toContain('CREATE');
		expect(stdout).toContain('OPLOG TEST PATTERN');
	});

	it('logs categorization operations', () => {
		const bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "OpLog Cat Bank"', bookId);
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-02 --description "To Categorize" --amount 50.00 --credit ${bankAccount.id}`,
			bookId
		);

		runMpWithBook(`tx:categorize ${tx.id} --debit ${testAccount.id}`, bookId);

		const { stdout } = runMpWithBook('log:list --limit 20', bookId);

		expect(stdout).toContain('CATEGORIZE');
	});

	it('gets operation details', () => {
		// Create something to get a log entry
		runMpWithBook('account:create --type asset --path "OpLog Detail Test"', bookId);

		// Get recent logs and find this one
		const { stdout: listOut } = runMpWithBook('log:list --limit 3', bookId);
		const match = listOut.match(/^(\S+)\s+/m);
		expect(match).not.toBeNull();

		const logId = match![1];
		const log = runMpJsonWithBook<OperationLog>(`log:get ${logId}`, bookId);

		expect(log.id).toBe(logId);
		expect(log.operation).toBeDefined();
		expect(log.changes).toBeDefined();
		expect(Array.isArray(log.changes)).toBe(true);
	});
});

// Helper to find log ID from output that contains the search term
// The log output has log ID on one line, description on the next
function findLogId(output: string, searchTerm: string): string | null {
	const lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(searchTerm)) {
			// If this line has the search term, check if it starts with a log ID
			// Log IDs are on lines that start with 'c' (cuid format)
			if (lines[i].match(/^c[a-z0-9]+\s+/)) {
				return lines[i].split(/\s+/)[0];
			}
			// Otherwise, the log ID is on the previous line
			if (i > 0 && lines[i - 1].match(/^c[a-z0-9]+\s+/)) {
				return lines[i - 1].split(/\s+/)[0];
			}
		}
	}
	return null;
}

describe('Undo Operations', () => {
	it('undoes account creation', () => {
		const account = runMpJsonWithBook<Account>('account:create --type expense --path "Undo Create Test"', bookId);

		// Find the log entry for this creation
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'Undo Create Test');
		expect(logId).not.toBeNull();

		// Undo it
		const { stdout } = runMpWithBook(`log:undo ${logId}`, bookId);
		expect(stdout).toContain('Undone');

		// Verify account is deleted
		const { exitCode } = runMpWithBook(`account:get ${account.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});

	it('undoes account update', () => {
		const account = runMpJsonWithBook<Account>('account:create --type expense --path "Undo Update Original"', bookId);

		// Update it
		runMpJsonWithBook<Account>(`account:update ${account.id} --path "Undo Update Changed"`, bookId);

		// Find the update log entry - search for UPDATE operation with account name
		const { stdout: listOut } = runMpWithBook('log:list --limit 20', bookId);
		const logId = findLogId(listOut, 'Undo Update Changed');
		expect(logId).not.toBeNull();

		// Undo it
		runMpWithBook(`log:undo ${logId}`, bookId);

		// Verify path is restored
		const restored = runMpJsonWithBook<Account>(`account:get ${account.id}`, bookId);
		expect(restored.path).toBe('Undo Update Original');
	});

	it('undoes transaction creation', () => {
		const account = runMpJsonWithBook<Account>('account:create --type asset --path "Undo TX Bank"', bookId);

		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Undo TX Test" --amount 75.00 --credit ${account.id}`,
			bookId
		);

		// Find the log entry
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'Undo TX Test');
		expect(logId).not.toBeNull();

		// Undo it
		const { stdout } = runMpWithBook(`log:undo ${logId}`, bookId);
		expect(stdout).toContain('Undone');

		// Verify transaction is deleted
		const { exitCode } = runMpWithBook(`tx:get ${tx.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});

	it('undoes categorization', () => {
		const bank = runMpJsonWithBook<Account>('account:create --type asset --path "Undo Cat Bank"', bookId);
		const expense = runMpJsonWithBook<Account>('account:create --type expense --path "Undo Cat Expense"', bookId);

		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-03 --description "Undo Categorize" --amount 30.00 --credit ${bank.id}`,
			bookId
		);

		// Categorize it
		runMpWithBook(`tx:categorize ${tx.id} --debit ${expense.id}`, bookId);

		// Find the categorize log entry - CATEGORIZE is on the header line
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const lines = listOut.split('\n').filter((l) => l.includes('CATEGORIZE'));
		expect(lines.length).toBeGreaterThan(0);
		const logId = lines[0].split(/\s+/)[0];

		// Undo it
		runMpWithBook(`log:undo ${logId}`, bookId);

		// Verify transaction is back to pending
		const restored = runMpJsonWithBook<Transaction>(`tx:get ${tx.id}`, bookId);
		expect(restored.status).toBe('PENDING');
		expect(restored.debitAccountId).toBeNull();
	});

	it('undoes rule creation', () => {
		const account = runMpJsonWithBook<Account>('account:create --type expense --path "Undo Rule Expense"', bookId);

		const rule = runMpJsonWithBook<Rule>(`rule:create "UNDO RULE PATTERN" --account ${account.id}`, bookId);

		// Find the log entry
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'UNDO RULE PATTERN');
		expect(logId).not.toBeNull();

		// Undo it
		runMpWithBook(`log:undo ${logId}`, bookId);

		// Verify rule is deleted
		const { exitCode } = runMpWithBook(`rule:get ${rule.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});

	it('marks operation as undone in log', () => {
		runMpWithBook('account:create --type expense --path "Mark Undone Test"', bookId);

		// Find and undo
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'Mark Undone Test');
		expect(logId).not.toBeNull();

		runMpWithBook(`log:undo ${logId}`, bookId);

		// Check log shows [UNDONE]
		const { stdout: afterList } = runMpWithBook('log:list --limit 10', bookId);
		const undoneLine = afterList.split('\n').find((l) => l.includes(logId!));
		expect(undoneLine).toContain('[UNDONE]');
	});

	it('prevents double undo', () => {
		runMpWithBook('account:create --type expense --path "Double Undo Test"', bookId);

		// Find the log entry
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'Double Undo Test');
		expect(logId).not.toBeNull();

		// Undo once
		const { stdout: firstUndo } = runMpWithBook(`log:undo ${logId}`, bookId);
		expect(firstUndo).toContain('Undone: 1');

		// Try to undo again - entity no longer exists, so it will skip
		const { stdout: secondUndo } = runMpWithBook(`log:undo ${logId}`, bookId);
		expect(secondUndo).toContain('skipped: 1');
	});
});

describe('Operation Log Edge Cases', () => {
	it('handles undo of deleted entity gracefully', () => {
		const account = runMpJsonWithBook<Account>('account:create --type expense --path "Already Deleted Test"', bookId);

		// Find the creation log
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const logId = findLogId(listOut, 'Already Deleted Test');
		expect(logId).not.toBeNull();

		// Delete the account directly (not via undo)
		runMpWithBook(`account:delete ${account.id}`, bookId);

		// Try to undo the creation (entity already gone)
		const { stdout } = runMpWithBook(`log:undo ${logId}`, bookId);
		// Should handle gracefully - either skip or report
		expect(stdout).toMatch(/Undone|skipped/i);
	});

	it('logs batch categorization as single operation', () => {
		const bank = runMpJsonWithBook<Account>('account:create --type asset --path "Batch Log Bank"', bookId);
		const expense = runMpJsonWithBook<Account>('account:create --type expense --path "Batch Log Expense"', bookId);

		// Create multiple transactions
		const tx1 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Batch 1" --amount 10.00 --credit ${bank.id}`,
			bookId
		);
		const tx2 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Batch 2" --amount 20.00 --credit ${bank.id}`,
			bookId
		);
		const tx3 = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "Batch 3" --amount 30.00 --credit ${bank.id}`,
			bookId
		);

		// Categorize all at once
		runMpWithBook(`tx:categorize ${tx1.id} ${tx2.id} ${tx3.id} --debit ${expense.id}`, bookId);

		// Should be a single log entry with multiple changes
		const { stdout: listOut } = runMpWithBook('log:list --limit 5', bookId);
		const catLine = listOut.split('\n').find((l) => l.includes('CATEGORIZE') && l.includes('3'));
		expect(catLine).toBeDefined();
		expect(catLine).toContain('3 change');
	});
});
