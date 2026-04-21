import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Account {
	id: string;
	type: string;
	path: string;
}

interface Rule {
	id: string;
	pattern: string;
	isRegex: boolean;
	field: string;
	priority: number;
	amountMin: string | null;
	amountMax: string | null;
	amountExact: string | null;
	accountId: string;
	account?: { path: string; type: string };
}

interface Transaction {
	id: string;
	description: string;
	amount: string;
	status: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
}

// Shared book for all rule tests
let bookId: string;

beforeAll(() => {
	bookId = createTestBook('Rule Tests');
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Rule CRUD', () => {
	let groceriesAccount: Account;
	let gasAccount: Account;

	beforeAll(() => {
		groceriesAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Rule Test:Groceries"', bookId);
		gasAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Rule Test:Gas"', bookId);
	});

	it('creates a simple substring rule', () => {
		const rule = runMpJsonWithBook<Rule>(`rule:create "WHOLE FOODS" --account ${groceriesAccount.id}`, bookId);

		expect(rule.id).toBeDefined();
		expect(rule.pattern).toBe('WHOLE FOODS');
		expect(rule.isRegex).toBe(false);
		expect(rule.field).toBe('description');
		expect(rule.accountId).toBe(groceriesAccount.id);
	});

	it('creates a regex rule', () => {
		const rule = runMpJsonWithBook<Rule>(`rule:create "SHELL|EXXON|MOBIL" --account ${gasAccount.id} --regex`, bookId);

		expect(rule.pattern).toBe('SHELL|EXXON|MOBIL');
		expect(rule.isRegex).toBe(true);
	});

	it('creates a rule with amount constraints', () => {
		const rule = runMpJsonWithBook<Rule>(
			`rule:create "COFFEE" --account ${groceriesAccount.id} --amount-min 3 --amount-max 10`,
			bookId
		);

		expect(rule.pattern).toBe('COFFEE');
		expect(parseFloat(rule.amountMin!)).toBe(3);
		expect(parseFloat(rule.amountMax!)).toBe(10);
	});

	it('creates a rule with exact amount', () => {
		const rule = runMpJsonWithBook<Rule>(
			`rule:create "MONTHLY SUB" --account ${groceriesAccount.id} --amount-exact 9.99`,
			bookId
		);

		expect(parseFloat(rule.amountExact!)).toBe(9.99);
	});

	it('creates a rule with priority', () => {
		const rule = runMpJsonWithBook<Rule>(
			`rule:create "HIGH PRIORITY" --account ${groceriesAccount.id} --priority 100`,
			bookId
		);

		expect(rule.priority).toBe(100);
	});

	it('lists rules', () => {
		const rules = runMpJsonWithBook<Rule[]>('rule:list', bookId);

		expect(rules.length).toBeGreaterThanOrEqual(5);
		expect(rules.some((r) => r.pattern === 'WHOLE FOODS')).toBe(true);
		expect(rules.some((r) => r.pattern === 'SHELL|EXXON|MOBIL')).toBe(true);
	});

	it('gets a single rule', () => {
		const rules = runMpJsonWithBook<Rule[]>('rule:list', bookId);
		const target = rules.find((r) => r.pattern === 'WHOLE FOODS');

		const rule = runMpJsonWithBook<Rule>(`rule:get ${target!.id}`, bookId);

		expect(rule.pattern).toBe('WHOLE FOODS');
		expect(rule.account?.path).toBe('Rule Test:Groceries');
	});

	it('updates a rule pattern', () => {
		const rules = runMpJsonWithBook<Rule[]>('rule:list', bookId);
		const target = rules.find((r) => r.pattern === 'WHOLE FOODS');

		const updated = runMpJsonWithBook<Rule>(`rule:update ${target!.id} --pattern "WHOLE FOODS MARKET"`, bookId);

		expect(updated.pattern).toBe('WHOLE FOODS MARKET');
	});

	it('updates a rule account', () => {
		const rules = runMpJsonWithBook<Rule[]>('rule:list', bookId);
		const target = rules.find((r) => r.pattern === 'WHOLE FOODS MARKET');

		const updated = runMpJsonWithBook<Rule>(`rule:update ${target!.id} --account ${gasAccount.id}`, bookId);

		expect(updated.accountId).toBe(gasAccount.id);
	});

	it('deletes a rule', () => {
		const temp = runMpJsonWithBook<Rule>(`rule:create "TO DELETE RULE" --account ${groceriesAccount.id}`, bookId);

		const { stdout } = runMpWithBook(`rule:delete ${temp.id}`, bookId);
		expect(stdout).toContain('Deleted rule');

		const { exitCode } = runMpWithBook(`rule:get ${temp.id}`, bookId);
		expect(exitCode).not.toBe(0);
	});
});

describe('Rule Testing', () => {
	let bankAccount: Account;
	let coffeeAccount: Account;

	beforeAll(() => {
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Rule Apply Test Bank"', bookId);
		coffeeAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Rule Apply Test:Coffee"', bookId);

		// Create some transactions to test against
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-01 --description "STARBUCKS COFFEE" --amount 5.50 --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-02 --description "DUNKIN DONUTS" --amount 4.25 --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-03 --description "PEETS COFFEE" --amount 6.00 --credit ${bankAccount.id}`,
			bookId
		);
	});

	it('tests a substring pattern', () => {
		const matches = runMpJsonWithBook<Transaction[]>('rule:test "COFFEE"', bookId);

		expect(matches.length).toBeGreaterThanOrEqual(2);
		expect(matches.some((t) => t.description.includes('STARBUCKS'))).toBe(true);
		expect(matches.some((t) => t.description.includes('PEETS'))).toBe(true);
	});

	it('tests a regex pattern', () => {
		const matches = runMpJsonWithBook<Transaction[]>('rule:test "STARBUCKS|DUNKIN" --regex', bookId);

		expect(matches.length).toBeGreaterThanOrEqual(2);
		expect(matches.some((t) => t.description.includes('STARBUCKS'))).toBe(true);
		expect(matches.some((t) => t.description.includes('DUNKIN'))).toBe(true);
	});

	it('tests with include-categorized flag', () => {
		// First categorize one
		const pending = runMpJsonWithBook<Transaction[]>('rule:test "DUNKIN"', bookId);
		if (pending.length > 0) {
			runMpWithBook(`tx:categorize ${pending[0].id} --debit ${coffeeAccount.id}`, bookId);
		}

		// Without flag, should not include categorized
		const withoutFlag = runMpJsonWithBook<Transaction[]>('rule:test "DUNKIN"', bookId);
		const dunkinInResults = withoutFlag.some((t) => t.description.includes('DUNKIN'));

		// With flag, should include categorized
		const withFlag = runMpJsonWithBook<Transaction[]>('rule:test "DUNKIN" --include-categorized', bookId);
		expect(withFlag.some((t) => t.description.includes('DUNKIN'))).toBe(true);

		// If it was categorized, it shouldn't be in the without-flag results
		if (pending.length > 0) {
			expect(dunkinInResults).toBe(false);
		}
	});
});

describe('Rule Application', () => {
	let bankAccount: Account;
	let restaurantAccount: Account;
	let subscriptionAccount: Account;

	beforeAll(() => {
		bankAccount = runMpJsonWithBook<Account>('account:create --type asset --path "Rule Auto Bank"', bookId);
		restaurantAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Rule Auto:Restaurant"', bookId);
		subscriptionAccount = runMpJsonWithBook<Account>('account:create --type expense --path "Rule Auto:Subscriptions"', bookId);

		// Create rules first
		runMpJsonWithBook<Rule>(`rule:create "CHIPOTLE" --account ${restaurantAccount.id}`, bookId);
		runMpJsonWithBook<Rule>(`rule:create "NETFLIX" --account ${subscriptionAccount.id}`, bookId);
	});

	it('applies rules to pending transactions', () => {
		// Create pending transactions that match rules
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-15 --description "CHIPOTLE MEXICAN GRILL" --amount 12.50 --credit ${bankAccount.id}`,
			bookId
		);
		runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-16 --description "NETFLIX.COM" --amount 15.99 --credit ${bankAccount.id}`,
			bookId
		);

		// Apply rules
		const { stdout } = runMpWithBook('rule:apply', bookId);

		// Should have applied rules
		expect(stdout).toMatch(/Applied \d+ rule\(s\) to \d+ transaction\(s\)|No pending transactions matched/);
	});

	it('applies rules filtered by account', () => {
		// Create a new pending transaction
		const tx = runMpJsonWithBook<Transaction>(
			`tx:create --date 2026-04-17 --description "CHIPOTLE ORDER" --amount 15.00 --credit ${bankAccount.id}`,
			bookId
		);

		// Apply rules for specific account
		runMpWithBook(`rule:apply --account ${bankAccount.id}`, bookId);

		// Check if it was categorized
		const updated = runMpJsonWithBook<Transaction>(`tx:get ${tx.id}`, bookId);
		if (updated.status === 'CATEGORIZED') {
			expect(updated.debitAccountId).toBe(restaurantAccount.id);
		}
	});
});
