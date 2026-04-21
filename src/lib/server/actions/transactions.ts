import { db } from '../db';
import { Prisma } from '@prisma/client';
import type { Transaction, TransactionStatus } from '@prisma/client';
import { logOperation, serialize, diff, type Change } from './operationLog';

/** Base filter to exclude merged transactions from user-facing queries */
export const activeTransactionFilter = { mergedIntoId: null };

export type SortColumn = 'date' | 'amount' | 'description';
export type SortOrder = 'asc' | 'desc';

export interface TransactionFilter {
	accountId?: string;
	uncategorized?: boolean;
	status?: TransactionStatus;
	from?: Date;
	to?: Date;
	search?: string;
	amountMin?: number;
	amountMax?: number;
	limit?: number;
	cursor?: string;
	sortBy?: SortColumn;
	sortOrder?: SortOrder;
}

export interface CreateTransactionData {
	date: Date;
	description: string;
	memo?: string;
	amount: number | Prisma.Decimal;
	debitAccountId?: string;
	creditAccountId?: string;
	status?: TransactionStatus;
	importSource?: string;
	importHash?: string;
}

export interface UpdateTransactionData {
	date?: Date;
	description?: string;
	memo?: string;
	amount?: number | Prisma.Decimal;
	debitAccountId?: string | null;
	creditAccountId?: string | null;
	status?: TransactionStatus;
}

type TransactionWithAccounts = Transaction & {
	debitAccount: { id: string; type: string; path: string } | null;
	creditAccount: { id: string; type: string; path: string } | null;
};

export interface TransactionListResult {
	transactions: TransactionWithAccounts[];
	nextCursor: string | null;
}

export type TransactionWithBalance = TransactionWithAccounts & { balance: number };

export interface TransactionWithBalanceResult {
	transactions: TransactionWithBalance[];
	nextCursor: string | null;
}

export async function listTransactions(
	bookId: string,
	filter?: TransactionFilter
): Promise<TransactionWithAccounts[]> {
	const result = await listTransactionsPaginated(bookId, filter);
	return result.transactions;
}

export async function listTransactionsPaginated(
	bookId: string,
	filter?: TransactionFilter
): Promise<TransactionListResult> {
	const sortBy = filter?.sortBy ?? 'date';
	const sortOrder = filter?.sortOrder ?? 'desc';

	// Build orderBy based on sort column
	const orderBy: Record<string, 'asc' | 'desc'>[] = [{ [sortBy]: sortOrder }];
	// Add secondary sort for stability
	if (sortBy !== 'date') {
		orderBy.push({ date: 'desc' });
	}
	if (sortBy !== 'amount') {
		orderBy.push({ amount: 'desc' });
	}

	// Fetch one extra to determine if there are more results
	const limit = filter?.limit;
	const take = limit ? limit + 1 : undefined;

	const transactions = await db.transaction.findMany({
		where: {
			AND: [
				{ bookId },
				activeTransactionFilter,
				filter?.accountId
					? {
							OR: [{ debitAccountId: filter.accountId }, { creditAccountId: filter.accountId }]
						}
					: {},
				filter?.uncategorized
					? {
							OR: [{ debitAccountId: null }, { creditAccountId: null }]
						}
					: {},
				filter?.status ? { status: filter.status } : {},
				filter?.from ? { date: { gte: filter.from } } : {},
				filter?.to ? { date: { lte: filter.to } } : {},
				filter?.search ? { description: { contains: filter.search, mode: 'insensitive' } } : {},
				filter?.amountMin !== undefined ? { amount: { gte: filter.amountMin } } : {},
				filter?.amountMax !== undefined ? { amount: { lte: filter.amountMax } } : {}
			]
		},
		include: {
			debitAccount: { select: { id: true, type: true, path: true } },
			creditAccount: { select: { id: true, type: true, path: true } }
		},
		orderBy,
		take,
		...(filter?.cursor && { skip: 1, cursor: { id: filter.cursor } })
	});

	// Check if there are more results
	const hasMore = limit ? transactions.length > limit : false;
	const results = hasMore ? transactions.slice(0, limit) : transactions;
	const nextCursor = hasMore ? results[results.length - 1]?.id ?? null : null;

	return { transactions: results, nextCursor };
}

/**
 * List transactions for a specific account with running balance calculated in SQL.
 * Uses window functions to compute cumulative balance, handling pagination correctly.
 */
export async function listTransactionsWithBalance(
	accountId: string,
	filter?: {
		from?: Date;
		to?: Date;
		limit?: number;
		cursor?: string;
	}
): Promise<TransactionWithBalanceResult> {
	const limit = filter?.limit ?? 50;

	// Get the account's opening balance
	const account = await db.account.findUnique({
		where: { id: accountId },
		select: { openingBalance: true }
	});
	const openingBalance = Number(account?.openingBalance ?? 0);

	// Build date filter conditions
	const conditions: string[] = [
		`(t."debitAccountId" = $1 OR t."creditAccountId" = $1)`,
		`t."merged_into_id" IS NULL`
	];
	const params: (string | Date | number)[] = [accountId];
	let paramIndex = 2;

	if (filter?.from) {
		conditions.push(`t.date >= $${paramIndex}`);
		params.push(filter.from);
		paramIndex++;
	}
	if (filter?.to) {
		conditions.push(`t.date <= $${paramIndex}`);
		params.push(filter.to);
		paramIndex++;
	}

	// For cursor-based pagination, we need to skip past the cursor
	let cursorCondition = '';
	if (filter?.cursor) {
		// Get the cursor transaction's date and id for proper ordering
		const cursorTx = await db.transaction.findUnique({
			where: { id: filter.cursor },
			select: { date: true, id: true }
		});
		if (cursorTx) {
			// Skip transactions that come before or at the cursor in our sort order (date DESC, id DESC)
			// Note: no table prefix - this condition is applied to the outer "ranked" CTE
			cursorCondition = `AND (date < $${paramIndex} OR (date = $${paramIndex} AND id < $${paramIndex + 1}))`;
			params.push(cursorTx.date, cursorTx.id);
		}
	}

	const whereClause = conditions.join(' AND ');

	// Query with window function to calculate running balance
	// The window function orders by date ASC to accumulate balance chronologically
	// Then we order results by date DESC for display
	const query = `
		WITH ranked AS (
			SELECT
				t.*,
				${openingBalance} + SUM(
					CASE WHEN t."debitAccountId" = $1 THEN t.amount ELSE 0 END -
					CASE WHEN t."creditAccountId" = $1 THEN t.amount ELSE 0 END
				) OVER (ORDER BY t.date ASC, t.id ASC) as balance
			FROM "Transaction" t
			WHERE ${whereClause}
		)
		SELECT *
		FROM ranked
		WHERE 1=1 ${cursorCondition}
		ORDER BY date DESC, id DESC
		LIMIT ${limit + 1}
	`;

	type RawRow = Transaction & { balance: number };
	const rows = await db.$queryRawUnsafe<RawRow[]>(query, ...params);

	// Check if there are more results
	const hasMore = rows.length > limit;
	const results = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? results[results.length - 1]?.id ?? null : null;

	// Fetch account details for debit/credit accounts
	const accountIds = new Set<string>();
	for (const row of results) {
		if (row.debitAccountId) accountIds.add(row.debitAccountId);
		if (row.creditAccountId) accountIds.add(row.creditAccountId);
	}

	const accounts = await db.account.findMany({
		where: { id: { in: Array.from(accountIds) } },
		select: { id: true, type: true, path: true }
	});
	const accountMap = new Map(accounts.map(a => [a.id, a]));

	// Transform to expected format
	const transactions: TransactionWithBalance[] = results.map(row => ({
		...row,
		debitAccount: row.debitAccountId ? accountMap.get(row.debitAccountId) ?? null : null,
		creditAccount: row.creditAccountId ? accountMap.get(row.creditAccountId) ?? null : null,
		balance: Number(row.balance)
	}));

	return { transactions, nextCursor };
}

export async function getTransaction(id: string): Promise<TransactionWithAccounts | null> {
	return db.transaction.findUnique({
		where: { id },
		include: {
			debitAccount: { select: { id: true, type: true, path: true } },
			creditAccount: { select: { id: true, type: true, path: true } }
		}
	});
}

export async function countTransactionsForAccount(accountId: string): Promise<number> {
	return db.transaction.count({
		where: {
			...activeTransactionFilter,
			OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }]
		}
	});
}

export interface TransactionSummaryGroup {
	description: string;
	count: number;
	totalAmount: number;
	minAmount: number;
	maxAmount: number;
	dateRange: { earliest: Date; latest: Date };
}

/**
 * Get a summary of transactions for an account, grouped by similar descriptions.
 * Groups similar descriptions together (e.g., "AMAZON.COM*123" and "AMAZON.COM*456").
 * Returns groups sorted by count (most common first), capped at maxGroups.
 */
export async function getTransactionSummary(
	bookId: string,
	accountId: string,
	maxGroups = 50
): Promise<TransactionSummaryGroup[]> {
	const transactions = await db.transaction.findMany({
		where: {
			bookId,
			...activeTransactionFilter,
			OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }]
		},
		select: { description: true, amount: true, date: true }
	});

	// Normalize description for grouping - remove trailing numbers, transaction IDs, etc.
	function normalizeDescription(desc: string): string {
		return desc
			// Remove trailing transaction IDs/reference numbers (common patterns)
			.replace(/\s*#\d+$/i, '')
			.replace(/\s*\*\w+$/i, '')  // AMAZON.COM*ABC123 -> AMAZON.COM
			.replace(/\s+\d{4,}$/i, '') // Remove trailing long numbers
			.replace(/\s+[A-Z0-9]{8,}$/i, '') // Remove trailing alphanumeric IDs
			// Normalize whitespace
			.replace(/\s+/g, ' ')
			.trim()
			.toUpperCase();
	}

	// Group transactions by normalized description
	const groups = new Map<string, {
		originalDescriptions: Set<string>;
		count: number;
		totalAmount: number;
		minAmount: number;
		maxAmount: number;
		earliest: Date;
		latest: Date;
	}>();

	for (const tx of transactions) {
		const key = normalizeDescription(tx.description);
		const amount = Number(tx.amount);

		const existing = groups.get(key);
		if (existing) {
			existing.originalDescriptions.add(tx.description);
			existing.count++;
			existing.totalAmount += amount;
			existing.minAmount = Math.min(existing.minAmount, amount);
			existing.maxAmount = Math.max(existing.maxAmount, amount);
			if (tx.date < existing.earliest) existing.earliest = tx.date;
			if (tx.date > existing.latest) existing.latest = tx.date;
		} else {
			groups.set(key, {
				originalDescriptions: new Set([tx.description]),
				count: 1,
				totalAmount: amount,
				minAmount: amount,
				maxAmount: amount,
				earliest: tx.date,
				latest: tx.date
			});
		}
	}

	// Convert to array, sort by count, and take top N
	const result: TransactionSummaryGroup[] = Array.from(groups.entries())
		.map(([key, data]) => ({
			// Use the most common original description, or the normalized key
			description: data.originalDescriptions.size === 1
				? Array.from(data.originalDescriptions)[0]
				: key,
			count: data.count,
			totalAmount: data.totalAmount,
			minAmount: data.minAmount,
			maxAmount: data.maxAmount,
			dateRange: { earliest: data.earliest, latest: data.latest }
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, maxGroups);

	return result;
}

export async function createTransaction(
	bookId: string,
	data: CreateTransactionData,
	options?: { skipLog?: boolean }
): Promise<Transaction> {
	const result = await db.transaction.create({
		data: {
			bookId,
			date: data.date,
			description: data.description,
			memo: data.memo,
			amount: data.amount,
			debitAccountId: data.debitAccountId,
			creditAccountId: data.creditAccountId,
			status: data.status ?? 'PENDING',
			importSource: data.importSource,
			importHash: data.importHash
		}
	});

	if (!options?.skipLog) {
		await logOperation(bookId, 'CREATE', `Created transaction: ${result.description}`, [
			{
				entityType: 'Transaction',
				entityId: result.id,
				before: null,
				after: serialize(result)
			}
		]);
	}

	return result;
}

export async function updateTransaction(
	id: string,
	data: UpdateTransactionData
): Promise<Transaction> {
	const before = await db.transaction.findUniqueOrThrow({ where: { id } });

	const updateData: Record<string, unknown> = {};

	if (data.date !== undefined) updateData.date = data.date;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.memo !== undefined) updateData.memo = data.memo;
	if (data.amount !== undefined) updateData.amount = data.amount;
	if (data.debitAccountId !== undefined) updateData.debitAccountId = data.debitAccountId;
	if (data.creditAccountId !== undefined) updateData.creditAccountId = data.creditAccountId;
	if (data.status !== undefined) updateData.status = data.status;

	const result = await db.transaction.update({
		where: { id },
		data: updateData
	});

	const { before: beforeDiff, after: afterDiff } = diff(serialize(before), serialize(result));
	if (Object.keys(beforeDiff).length > 0) {
		await logOperation(result.bookId, 'UPDATE', `Updated transaction: ${result.description}`, [
			{
				entityType: 'Transaction',
				entityId: id,
				before: beforeDiff,
				after: afterDiff
			}
		]);
	}

	return result;
}

export async function deleteTransaction(id: string): Promise<void> {
	const before = await db.transaction.findUniqueOrThrow({ where: { id } });
	await db.transaction.delete({ where: { id } });

	await logOperation(before.bookId, 'DELETE', `Deleted transaction: ${before.description}`, [
		{
			entityType: 'Transaction',
			entityId: id,
			before: serialize(before),
			after: null
		}
	]);
}

export async function deleteImportedTransactions(bookId: string, source?: string): Promise<{ deleted: number }> {
	const result = await db.transaction.deleteMany({
		where: {
			bookId,
			importSource: source ? { equals: source } : { not: null }
		}
	});
	return { deleted: result.count };
}

export async function categorizeTransactions(
	ids: string[],
	accountId: string,
	side: 'debit' | 'credit'
): Promise<{ updated: number }> {
	// Fetch before state for logging
	const beforeTxs = await db.transaction.findMany({
		where: { id: { in: ids } }
	});

	const result = await db.transaction.updateMany({
		where: { id: { in: ids } },
		data:
			side === 'debit'
				? { debitAccountId: accountId, status: 'CATEGORIZED' }
				: { creditAccountId: accountId, status: 'CATEGORIZED' }
	});

	// Fetch account path for description
	const account = await db.account.findUnique({
		where: { id: accountId },
		select: { path: true }
	});

	if (beforeTxs.length > 0) {
		const changes: Change[] = beforeTxs.map((tx) => ({
			entityType: 'Transaction' as const,
			entityId: tx.id,
			before: {
				[side === 'debit' ? 'debitAccountId' : 'creditAccountId']:
					side === 'debit' ? tx.debitAccountId : tx.creditAccountId,
				status: tx.status
			},
			after: {
				[side === 'debit' ? 'debitAccountId' : 'creditAccountId']: accountId,
				status: 'CATEGORIZED'
			}
		}));

		await logOperation(
			beforeTxs[0].bookId,
			'CATEGORIZE',
			`Categorized ${result.count} transaction${result.count === 1 ? '' : 's'} as ${account?.path ?? accountId}`,
			changes
		);
	}

	return { updated: result.count };
}

export async function categorizeTransactionsAuto(
	ids: string[],
	accountId: string
): Promise<{ updated: number }> {
	// Fetch transactions to determine which side needs to be filled
	const transactions = await db.transaction.findMany({
		where: { id: { in: ids } },
		select: { id: true, bookId: true, debitAccountId: true, creditAccountId: true, status: true }
	});

	const changes: Change[] = [];
	let updated = 0;

	for (const tx of transactions) {
		// Fill in the missing side
		if (tx.debitAccountId && !tx.creditAccountId) {
			// Debit side is set (e.g., bank account for deposit), fill credit side (source)
			await db.transaction.update({
				where: { id: tx.id },
				data: { creditAccountId: accountId, status: 'CATEGORIZED' }
			});
			changes.push({
				entityType: 'Transaction',
				entityId: tx.id,
				before: { creditAccountId: tx.creditAccountId, status: tx.status },
				after: { creditAccountId: accountId, status: 'CATEGORIZED' }
			});
			updated++;
		} else if (tx.creditAccountId && !tx.debitAccountId) {
			// Credit side is set (e.g., bank account for withdrawal), fill debit side (destination/expense)
			await db.transaction.update({
				where: { id: tx.id },
				data: { debitAccountId: accountId, status: 'CATEGORIZED' }
			});
			changes.push({
				entityType: 'Transaction',
				entityId: tx.id,
				before: { debitAccountId: tx.debitAccountId, status: tx.status },
				after: { debitAccountId: accountId, status: 'CATEGORIZED' }
			});
			updated++;
		}
	}

	if (changes.length > 0) {
		const account = await db.account.findUnique({
			where: { id: accountId },
			select: { path: true }
		});

		await logOperation(
			transactions[0].bookId,
			'CATEGORIZE',
			`Categorized ${updated} transaction${updated === 1 ? '' : 's'} as ${account?.path ?? accountId}`,
			changes
		);
	}

	return { updated };
}

export async function getUncategorized(bookId: string, filter?: {
	accountId?: string;
	limit?: number;
}): Promise<TransactionWithAccounts[]> {
	return listTransactions(bookId, {
		accountId: filter?.accountId,
		status: 'PENDING',
		limit: filter?.limit
	});
}

export interface MergeResult {
	survivorId: string;
	mergedId: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
}

export async function mergeTransactions(id1: string, id2: string): Promise<MergeResult> {
	const [tx1, tx2] = await Promise.all([
		db.transaction.findUnique({ where: { id: id1 } }),
		db.transaction.findUnique({ where: { id: id2 } })
	]);

	if (!tx1) throw new Error(`Transaction not found: ${id1}`);
	if (!tx2) throw new Error(`Transaction not found: ${id2}`);

	// Validate amounts match
	if (!tx1.amount.equals(tx2.amount)) {
		throw new Error(
			`Amount mismatch: ${tx1.amount.toString()} vs ${tx2.amount.toString()}`
		);
	}

	// Check neither is already merged
	if (tx1.mergedIntoId) throw new Error(`Transaction ${id1} is already merged`);
	if (tx2.mergedIntoId) throw new Error(`Transaction ${id2} is already merged`);

	// Check for conflicts (both have the same side filled with different accounts)
	if (tx1.debitAccountId && tx2.debitAccountId && tx1.debitAccountId !== tx2.debitAccountId) {
		throw new Error(
			`Debit account conflict: ${tx1.debitAccountId} vs ${tx2.debitAccountId}`
		);
	}
	if (tx1.creditAccountId && tx2.creditAccountId && tx1.creditAccountId !== tx2.creditAccountId) {
		throw new Error(
			`Credit account conflict: ${tx1.creditAccountId} vs ${tx2.creditAccountId}`
		);
	}

	// Determine which accounts to keep
	// Prefer the complete pair if one tx has both accounts set
	const tx1Complete = tx1.debitAccountId && tx1.creditAccountId;
	const tx2Complete = tx2.debitAccountId && tx2.creditAccountId;

	let debitAccountId: string | null;
	let creditAccountId: string | null;

	if (tx1Complete) {
		debitAccountId = tx1.debitAccountId;
		creditAccountId = tx1.creditAccountId;
	} else if (tx2Complete) {
		debitAccountId = tx2.debitAccountId;
		creditAccountId = tx2.creditAccountId;
	} else {
		// Neither complete, combine filled sides from both
		debitAccountId = tx1.debitAccountId || tx2.debitAccountId;
		creditAccountId = tx1.creditAccountId || tx2.creditAccountId;
	}

	// Use earlier date as the survivor
	const survivor = tx1.date <= tx2.date ? tx1 : tx2;
	const merged = survivor === tx1 ? tx2 : tx1;

	// Determine new status - take the highest status between the two
	// CATEGORIZED > PENDING
	const statusRank = { PENDING: 0, CATEGORIZED: 1 };
	const maxRank = Math.max(statusRank[tx1.status], statusRank[tx2.status]);
	let newStatus: TransactionStatus;
	if (maxRank === 1 || (debitAccountId && creditAccountId)) {
		newStatus = 'CATEGORIZED';
	} else {
		newStatus = 'PENDING';
	}

	// Update survivor with combined accounts, mark merged
	await db.$transaction([
		db.transaction.update({
			where: { id: survivor.id },
			data: {
				debitAccountId,
				creditAccountId,
				status: newStatus
			}
		}),
		db.transaction.update({
			where: { id: merged.id },
			data: { mergedIntoId: survivor.id }
		})
	]);

	// Log the merge operation
	const changes: Change[] = [
		{
			entityType: 'Transaction',
			entityId: survivor.id,
			before: {
				debitAccountId: survivor.debitAccountId,
				creditAccountId: survivor.creditAccountId,
				status: survivor.status
			},
			after: {
				debitAccountId,
				creditAccountId,
				status: newStatus
			}
		},
		{
			entityType: 'Transaction',
			entityId: merged.id,
			before: { mergedIntoId: merged.mergedIntoId },
			after: { mergedIntoId: survivor.id }
		}
	];

	await logOperation(survivor.bookId, 'MERGE', `Merged duplicate: ${survivor.description}`, changes);

	return {
		survivorId: survivor.id,
		mergedId: merged.id,
		debitAccountId,
		creditAccountId
	};
}

export async function unmergeTransaction(mergedId: string): Promise<void> {
	const tx = await db.transaction.findUnique({ where: { id: mergedId } });
	if (!tx) throw new Error(`Transaction not found: ${mergedId}`);
	if (!tx.mergedIntoId) throw new Error(`Transaction ${mergedId} is not merged`);

	const survivorId = tx.mergedIntoId;

	await db.transaction.update({
		where: { id: mergedId },
		data: { mergedIntoId: null }
	});

	await logOperation(tx.bookId, 'UPDATE', `Unmerged transaction: ${tx.description}`, [
		{
			entityType: 'Transaction',
			entityId: mergedId,
			before: { mergedIntoId: survivorId },
			after: { mergedIntoId: null }
		}
	]);
}

export async function flipTransactionAccounts(ids: string[]): Promise<{ updated: number }> {
	// Fetch before state for logging
	const beforeTxs = await db.transaction.findMany({
		where: { id: { in: ids } }
	});

	if (beforeTxs.length === 0) {
		return { updated: 0 };
	}

	const changes: Change[] = [];

	for (const tx of beforeTxs) {
		await db.transaction.update({
			where: { id: tx.id },
			data: {
				debitAccountId: tx.creditAccountId,
				creditAccountId: tx.debitAccountId
			}
		});

		changes.push({
			entityType: 'Transaction',
			entityId: tx.id,
			before: {
				debitAccountId: tx.debitAccountId,
				creditAccountId: tx.creditAccountId
			},
			after: {
				debitAccountId: tx.creditAccountId,
				creditAccountId: tx.debitAccountId
			}
		});
	}

	await logOperation(
		beforeTxs[0].bookId,
		'UPDATE',
		`Flipped accounts on ${changes.length} transaction${changes.length === 1 ? '' : 's'}`,
		changes
	);

	return { updated: changes.length };
}

export interface MergeCandidate {
	tx1: TransactionWithAccounts;
	tx2: TransactionWithAccounts;
	score: number;
	reasons: string[];
}

/**
 * Mark two transactions as explicitly NOT duplicates.
 */
export async function dismissDuplicate(tx1Id: string, tx2Id: string): Promise<void> {
	// Always store with smaller ID first for consistency
	const [id1, id2] = tx1Id < tx2Id ? [tx1Id, tx2Id] : [tx2Id, tx1Id];

	await db.dismissedDuplicate.upsert({
		where: { tx1Id_tx2Id: { tx1Id: id1, tx2Id: id2 } },
		create: { tx1Id: id1, tx2Id: id2 },
		update: {}
	});
}

/**
 * Find potential duplicate transfers that could be merged.
 * Looks for transactions with matching amounts where one has debit set
 * and the other has credit set (typical of importing from both sides of a transfer).
 */
export async function findMergeCandidates(bookId: string, maxDaysDiff = 7): Promise<MergeCandidate[]> {
	// Get all active transactions and dismissed pairs
	const [transactions, dismissedPairs] = await Promise.all([
		db.transaction.findMany({
			where: { bookId, ...activeTransactionFilter },
			include: {
				debitAccount: { select: { id: true, type: true, path: true } },
				creditAccount: { select: { id: true, type: true, path: true } }
			},
			orderBy: { date: 'asc' }
		}),
		db.dismissedDuplicate.findMany({
			select: { tx1Id: true, tx2Id: true }
		})
	]);

	// Build a set of dismissed pair keys for fast lookup
	const dismissedSet = new Set(
		dismissedPairs.map((d) => `${d.tx1Id}:${d.tx2Id}`)
	);

	const candidates: MergeCandidate[] = [];

	// Group transactions by amount for efficient matching
	const byAmount = new Map<string, TransactionWithAccounts[]>();
	for (const tx of transactions) {
		const key = tx.amount.toString();
		if (!byAmount.has(key)) byAmount.set(key, []);
		byAmount.get(key)!.push(tx);
	}

	// Find pairs with matching amounts
	for (const [, txs] of byAmount) {
		if (txs.length < 2) continue;

		for (let i = 0; i < txs.length; i++) {
			for (let j = i + 1; j < txs.length; j++) {
				const tx1 = txs[i];
				const tx2 = txs[j];

				// Check if this pair was dismissed (IDs are stored in sorted order)
				const [id1, id2] = tx1.id < tx2.id ? [tx1.id, tx2.id] : [tx2.id, tx1.id];
				if (dismissedSet.has(`${id1}:${id2}`)) continue;

				// Skip if both transactions came from the same import source AND share the same
				// account on the same side - these are separate transactions, not transfer duplicates.
				// True transfer duplicates come from different sources (e.g., checking + credit card).
				if (tx1.importSource && tx1.importSource === tx2.importSource) {
					const sameDebit = tx1.debitAccountId && tx1.debitAccountId === tx2.debitAccountId;
					const sameCredit = tx1.creditAccountId && tx1.creditAccountId === tx2.creditAccountId;
					if (sameDebit || sameCredit) continue;
				}

				// Check date proximity
				const daysDiff = Math.abs(tx1.date.getTime() - tx2.date.getTime()) / (1000 * 60 * 60 * 24);
				if (daysDiff > maxDaysDiff) continue;

				// Skip if both have the same side filled (not a transfer pair)
				const tx1HasDebit = !!tx1.debitAccountId;
				const tx1HasCredit = !!tx1.creditAccountId;
				const tx2HasDebit = !!tx2.debitAccountId;
				const tx2HasCredit = !!tx2.creditAccountId;

				// Ideal case: one has debit, other has credit (transfer from different imports)
				const isComplementary =
					(tx1HasDebit && !tx1HasCredit && !tx2HasDebit && tx2HasCredit) ||
					(!tx1HasDebit && tx1HasCredit && tx2HasDebit && !tx2HasCredit);

				// Also consider if they would conflict (both have debit or both have credit)
				const wouldConflict =
					(tx1HasDebit && tx2HasDebit && tx1.debitAccountId !== tx2.debitAccountId) ||
					(tx1HasCredit && tx2HasCredit && tx1.creditAccountId !== tx2.creditAccountId);

				if (wouldConflict) continue;

				// Calculate match score
				let score = 0;
				const reasons: string[] = [];

				// Amount match (already guaranteed)
				score += 30;
				reasons.push('Same amount');

				// Unusual amount boost - specific amounts are less likely to be coincidental
				const amount = Number(tx1.amount);
				if (amount >= 100) {
					const cents = Math.round((amount % 1) * 100);
					const isCommonEnding = cents === 0 || cents === 99;
					if (!isCommonEnding) {
						score += 15;
						reasons.push('Unusual amount');
					}
				}

				// Date proximity
				if (daysDiff === 0) {
					score += 30;
					reasons.push('Same date');
				} else if (daysDiff <= 1) {
					score += 25;
					reasons.push('1 day apart');
				} else if (daysDiff <= 3) {
					score += 15;
					reasons.push(`${Math.round(daysDiff)} days apart`);
				} else {
					score += 5;
					reasons.push(`${Math.round(daysDiff)} days apart`);
				}

				// Complementary accounts (strong signal)
				if (isComplementary) {
					score += 30;
					reasons.push('Complementary accounts');
				}

				// Description similarity
				const desc1 = tx1.description.toLowerCase();
				const desc2 = tx2.description.toLowerCase();
				if (desc1 === desc2) {
					score += 10;
					reasons.push('Same description');
				} else if (desc1.includes(desc2) || desc2.includes(desc1)) {
					score += 5;
					reasons.push('Similar description');
				}

				// Only include if score is reasonable
				if (score >= 50) {
					candidates.push({ tx1, tx2, score, reasons });
				}
			}
		}
	}

	// Sort by score (descending), then amount (descending), then date (ascending) for stability
	candidates.sort((a, b) => {
		const scoreDiff = b.score - a.score;
		if (scoreDiff !== 0) return scoreDiff;
		const amountDiff = Number(b.tx1.amount) - Number(a.tx1.amount);
		if (amountDiff !== 0) return amountDiff;
		return a.tx1.date.getTime() - b.tx1.date.getTime();
	});

	return candidates;
}
