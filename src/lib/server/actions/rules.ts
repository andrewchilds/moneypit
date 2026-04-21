import { db } from '../db';
import type { Rule, Prisma } from '@prisma/client';
import { activeTransactionFilter } from './transactions';
import { logOperation, serialize, diff } from './operationLog';

export interface CreateRuleOptions {
	field?: string;
	priority?: number;
	isRegex?: boolean;
	amountMin?: number | Prisma.Decimal;
	amountMax?: number | Prisma.Decimal;
	amountExact?: number | Prisma.Decimal;
}

export interface UpdateRuleData {
	pattern?: string;
	accountId?: string;
	field?: string;
	priority?: number;
	isRegex?: boolean;
	amountMin?: number | Prisma.Decimal | null;
	amountMax?: number | Prisma.Decimal | null;
	amountExact?: number | Prisma.Decimal | null;
}

type RuleWithAccount = Rule & {
	account: { id: string; type: string; path: string };
};

export async function listRules(bookId: string): Promise<RuleWithAccount[]> {
	return db.rule.findMany({
		where: { bookId },
		include: {
			account: { select: { id: true, type: true, path: true } }
		},
		orderBy: [{ priority: 'desc' }, { pattern: 'asc' }]
	});
}

export async function countRulesForAccount(accountId: string): Promise<number> {
	return db.rule.count({ where: { accountId } });
}

export async function listRulesForAccount(accountId: string): Promise<Rule[]> {
	return db.rule.findMany({
		where: { accountId },
		orderBy: [{ priority: 'desc' }, { pattern: 'asc' }]
	});
}

export async function getRule(id: string): Promise<RuleWithAccount | null> {
	return db.rule.findUnique({
		where: { id },
		include: {
			account: { select: { id: true, type: true, path: true } }
		}
	});
}

export async function createRule(
	bookId: string,
	pattern: string,
	accountId: string,
	opts?: CreateRuleOptions
): Promise<Rule> {
	const result = await db.rule.create({
		data: {
			bookId,
			pattern,
			accountId,
			field: opts?.field ?? 'description',
			priority: opts?.priority ?? 0,
			isRegex: opts?.isRegex ?? false,
			amountMin: opts?.amountMin,
			amountMax: opts?.amountMax,
			amountExact: opts?.amountExact
		}
	});

	await logOperation(bookId, 'CREATE', `Created rule: ${pattern}`, [
		{
			entityType: 'Rule',
			entityId: result.id,
			before: null,
			after: serialize(result)
		}
	]);

	return result;
}

export async function updateRule(id: string, data: UpdateRuleData): Promise<Rule> {
	const before = await db.rule.findUniqueOrThrow({ where: { id } });

	const result = await db.rule.update({
		where: { id },
		data
	});

	const { before: beforeDiff, after: afterDiff } = diff(serialize(before), serialize(result));
	if (Object.keys(beforeDiff).length > 0) {
		await logOperation(result.bookId, 'UPDATE', `Updated rule: ${result.pattern}`, [
			{
				entityType: 'Rule',
				entityId: id,
				before: beforeDiff,
				after: afterDiff
			}
		]);
	}

	return result;
}

export async function deleteRule(id: string): Promise<void> {
	const before = await db.rule.findUniqueOrThrow({ where: { id } });
	await db.rule.delete({ where: { id } });

	await logOperation(before.bookId, 'DELETE', `Deleted rule: ${before.pattern}`, [
		{
			entityType: 'Rule',
			entityId: id,
			before: serialize(before),
			after: null
		}
	]);
}

export interface TestRuleResult {
	id: string;
	description: string;
	amount: Prisma.Decimal;
	date: Date;
}

export async function testRule(
	bookId: string,
	pattern: string,
	field: string = 'description',
	isRegex: boolean = false,
	includeCategorized: boolean = false
): Promise<TestRuleResult[]> {
	// Get transactions (pending only by default, or all if includeCategorized)
	const transactions = await db.transaction.findMany({
		where: includeCategorized ? { bookId, ...activeTransactionFilter } : { bookId, status: 'PENDING', ...activeTransactionFilter },
		select: { id: true, description: true, memo: true, amount: true, date: true }
	});

	const matches: TestRuleResult[] = [];

	for (const tx of transactions) {
		const value = field === 'memo' ? tx.memo : tx.description;
		if (!value) continue;

		let matched = false;
		if (isRegex) {
			try {
				const regex = new RegExp(pattern, 'i');
				matched = regex.test(value);
			} catch {
				// Invalid regex, skip
			}
		} else {
			matched = value.toLowerCase().includes(pattern.toLowerCase());
		}

		if (matched) {
			matches.push({
				id: tx.id,
				description: tx.description,
				amount: tx.amount,
				date: tx.date
			});
		}
	}

	return matches;
}

export interface ApplyRulesResult {
	transactionsUpdated: number;
	rulesApplied: number;
}

export interface ApplyRulesOptions {
	accountId?: string; // Only apply rules for this account
	transactionIds?: string[]; // Only apply to specific transactions
}

export async function applyRules(bookId: string, opts?: ApplyRulesOptions): Promise<ApplyRulesResult> {
	// Get rules, optionally filtered by account
	const rules = await db.rule.findMany({
		where: { bookId, ...(opts?.accountId ? { accountId: opts.accountId } : {}) },
		include: {
			account: { select: { id: true, type: true, path: true } }
		},
		orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
	});

	if (rules.length === 0) {
		return { transactionsUpdated: 0, rulesApplied: 0 };
	}

	// Get pending transactions that need categorization
	const whereClause: Prisma.TransactionWhereInput = {
		bookId,
		status: 'PENDING',
		...activeTransactionFilter,
		...(opts?.transactionIds ? { id: { in: opts.transactionIds } } : {})
	};

	const transactions = await db.transaction.findMany({
		where: whereClause,
		select: {
			id: true,
			description: true,
			memo: true,
			amount: true,
			debitAccountId: true,
			creditAccountId: true
		}
	});

	if (transactions.length === 0) {
		return { transactionsUpdated: 0, rulesApplied: 0 };
	}

	// Track which transactions get updated and by which rules
	const updates: Map<string, { txId: string; accountId: string; side: 'debit' | 'credit'; rulePath: string }> = new Map();
	const rulesUsed = new Set<string>();

	// Match transactions against rules
	for (const tx of transactions) {
		// Skip if already fully categorized
		if (tx.debitAccountId && tx.creditAccountId) continue;

		for (const rule of rules) {
			// Fill whichever side is empty - the account type doesn't dictate the side
			// because it depends on context (e.g., expense goes on credit for credit card txs)
			const side: 'debit' | 'credit' = !tx.debitAccountId ? 'debit' : 'credit';

			// Check pattern match
			const value = rule.field === 'memo' ? tx.memo : tx.description;
			if (!value) continue;

			let matched = false;
			if (rule.isRegex) {
				try {
					const regex = new RegExp(rule.pattern, 'i');
					matched = regex.test(value);
				} catch {
					// Invalid regex, skip
				}
			} else {
				matched = value.toLowerCase().includes(rule.pattern.toLowerCase());
			}

			if (!matched) continue;

			// Check amount filters
			const amount = Number(tx.amount);
			if (rule.amountExact !== null && amount !== Number(rule.amountExact)) continue;
			if (rule.amountMin !== null && amount < Number(rule.amountMin)) continue;
			if (rule.amountMax !== null && amount > Number(rule.amountMax)) continue;

			// Match found! Record the update (first matching rule wins due to priority order)
			updates.set(tx.id, {
				txId: tx.id,
				accountId: rule.accountId,
				side,
				rulePath: rule.account.path
			});
			rulesUsed.add(rule.id);
			break; // Stop checking rules for this transaction
		}
	}

	if (updates.size === 0) {
		return { transactionsUpdated: 0, rulesApplied: 0 };
	}

	// Apply updates in a transaction
	const changes: { entityType: 'Transaction'; entityId: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];

	await db.$transaction(async (prisma) => {
		for (const update of updates.values()) {
			const before = await prisma.transaction.findUnique({ where: { id: update.txId } });

			await prisma.transaction.update({
				where: { id: update.txId },
				data: {
					[update.side === 'debit' ? 'debitAccountId' : 'creditAccountId']: update.accountId,
					status: 'CATEGORIZED'
				}
			});

			if (before) {
				changes.push({
					entityType: 'Transaction',
					entityId: update.txId,
					before: {
						[update.side === 'debit' ? 'debitAccountId' : 'creditAccountId']:
							update.side === 'debit' ? before.debitAccountId : before.creditAccountId,
						status: before.status
					},
					after: {
						[update.side === 'debit' ? 'debitAccountId' : 'creditAccountId']: update.accountId,
						status: 'CATEGORIZED'
					}
				});
			}
		}
	});

	// Log the operation
	if (changes.length > 0) {
		await logOperation(
			bookId,
			'CATEGORIZE',
			`Applied ${rulesUsed.size} rule${rulesUsed.size === 1 ? '' : 's'} to ${updates.size} transaction${updates.size === 1 ? '' : 's'}`,
			changes
		);
	}

	return {
		transactionsUpdated: updates.size,
		rulesApplied: rulesUsed.size
	};
}
