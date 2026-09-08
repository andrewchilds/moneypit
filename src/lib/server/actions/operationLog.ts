import { db } from '$lib/server/db';
import { scheduleBackupCheck } from '$lib/server/backup';
import type { Prisma } from '@prisma/client';

export type EntityType =
	| 'Account'
	| 'Transaction'
	| 'Rule'
	| 'TaxCategory'
	| 'BalanceRecord'
	| 'DismissedDuplicate'
	| 'TaxDocument'
	| 'TaxDocumentLine'
	| 'TaxFact';

export interface Change {
	entityType: EntityType;
	entityId: string;
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
}

export type Operation =
	| 'CREATE'
	| 'UPDATE'
	| 'DELETE'
	| 'CATEGORIZE'
	| 'MERGE'
	| 'IMPORT'
	| 'UNDO';

export async function logOperation(
	bookId: string,
	operation: Operation,
	description: string,
	changes: Change[]
): Promise<void> {
	await db.operationLog.create({
		data: {
			bookId,
			operation,
			description,
			changes: changes as unknown as Prisma.JsonArray
		}
	});
	scheduleBackupCheck();
}

export async function getRecentOperations(bookId: string, limit = 50, offset = 0) {
	const [operations, total] = await Promise.all([
		db.operationLog.findMany({
			where: { bookId },
			orderBy: { createdAt: 'desc' },
			take: limit,
			skip: offset
		}),
		db.operationLog.count({ where: { bookId } })
	]);
	return { operations, total };
}

export async function getOperation(id: string) {
	return db.operationLog.findUnique({ where: { id } });
}

// Helper to compute changed fields between two objects
export function diff<T extends Record<string, unknown>>(
	before: T,
	after: T
): { before: Partial<T>; after: Partial<T> } {
	const beforeDiff: Partial<T> = {};
	const afterDiff: Partial<T> = {};

	const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of allKeys) {
		const k = key as keyof T;
		if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
			beforeDiff[k] = before[k];
			afterDiff[k] = after[k];
		}
	}

	return { before: beforeDiff, after: afterDiff };
}

// Helper to serialize entity for logging (handles Decimal, Date, etc.)
export function serialize<T>(obj: T): Record<string, unknown> {
	return JSON.parse(
		JSON.stringify(obj, (_, value) => {
			if (value instanceof Date) return value.toISOString();
			if (typeof value === 'bigint') return value.toString();
			if (value?.constructor?.name === 'Decimal') return value.toString();
			return value;
		})
	);
}

export interface UndoResult {
	undone: number;
	skipped: number;
}

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function entityExists(
	tx: TransactionClient,
	type: EntityType,
	id: string
): Promise<boolean> {
	let count: number;
	switch (type) {
		case 'Account':
			count = await tx.account.count({ where: { id } });
			break;
		case 'Transaction':
			count = await tx.transaction.count({ where: { id } });
			break;
		case 'Rule':
			count = await tx.rule.count({ where: { id } });
			break;
		case 'TaxCategory':
			count = await tx.taxCategory.count({ where: { id } });
			break;
		case 'BalanceRecord':
			count = await tx.balanceRecord.count({ where: { id } });
			break;
		case 'DismissedDuplicate':
			count = await tx.dismissedDuplicate.count({ where: { id } });
			break;
		case 'TaxDocument':
			count = await tx.taxDocument.count({ where: { id } });
			break;
		case 'TaxDocumentLine':
			count = await tx.taxDocumentLine.count({ where: { id } });
			break;
		case 'TaxFact':
			count = await tx.taxFact.count({ where: { id } });
			break;
	}
	return count > 0;
}

async function deleteEntity(
	tx: TransactionClient,
	type: EntityType,
	id: string
): Promise<void> {
	switch (type) {
		case 'Account':
			await tx.account.delete({ where: { id } });
			break;
		case 'Transaction':
			await tx.transaction.delete({ where: { id } });
			break;
		case 'Rule':
			await tx.rule.delete({ where: { id } });
			break;
		case 'TaxCategory':
			await tx.taxCategory.delete({ where: { id } });
			break;
		case 'BalanceRecord':
			await tx.balanceRecord.delete({ where: { id } });
			break;
		case 'DismissedDuplicate':
			await tx.dismissedDuplicate.delete({ where: { id } });
			break;
		case 'TaxDocument':
			await tx.taxDocument.delete({ where: { id } });
			break;
		case 'TaxDocumentLine':
			await tx.taxDocumentLine.delete({ where: { id } });
			break;
		case 'TaxFact':
			await tx.taxFact.delete({ where: { id } });
			break;
	}
}

async function recreateEntity(
	tx: TransactionClient,
	type: EntityType,
	data: Record<string, unknown>
): Promise<void> {
	// Remove relation fields and timestamps that Prisma manages
	const cleanData = { ...data };
	delete cleanData.createdAt;
	delete cleanData.updatedAt;

	switch (type) {
		case 'Account':
			delete cleanData.debitTransactions;
			delete cleanData.creditTransactions;
			delete cleanData.rules;
			delete cleanData.balanceRecords;
			delete cleanData.taxCategory;
			await tx.account.create({ data: cleanData as Prisma.AccountUncheckedCreateInput });
			break;
		case 'Transaction':
			delete cleanData.debitAccount;
			delete cleanData.creditAccount;
			delete cleanData.mergedInto;
			delete cleanData.mergedFrom;
			delete cleanData.dismissedDupes1;
			delete cleanData.dismissedDupes2;
			await tx.transaction.create({ data: cleanData as Prisma.TransactionUncheckedCreateInput });
			break;
		case 'Rule':
			delete cleanData.account;
			await tx.rule.create({ data: cleanData as Prisma.RuleUncheckedCreateInput });
			break;
		case 'TaxCategory':
			delete cleanData.accounts;
			await tx.taxCategory.create({ data: cleanData as Prisma.TaxCategoryUncheckedCreateInput });
			break;
		case 'BalanceRecord':
			delete cleanData.account;
			await tx.balanceRecord.create({
				data: cleanData as Prisma.BalanceRecordUncheckedCreateInput
			});
			break;
		case 'DismissedDuplicate':
			delete cleanData.tx1;
			delete cleanData.tx2;
			await tx.dismissedDuplicate.create({
				data: cleanData as Prisma.DismissedDuplicateUncheckedCreateInput
			});
			break;
		case 'TaxDocument':
			delete cleanData.lines;
			delete cleanData.account;
			await tx.taxDocument.create({ data: cleanData as Prisma.TaxDocumentUncheckedCreateInput });
			break;
		case 'TaxDocumentLine':
			delete cleanData.document;
			delete cleanData.taxCategory;
			await tx.taxDocumentLine.create({ data: cleanData as Prisma.TaxDocumentLineUncheckedCreateInput });
			break;
		case 'TaxFact':
			await tx.taxFact.create({ data: cleanData as Prisma.TaxFactUncheckedCreateInput });
			break;
	}
}

async function updateEntity(
	tx: TransactionClient,
	type: EntityType,
	id: string,
	data: Record<string, unknown>
): Promise<void> {
	// Remove fields that shouldn't be updated
	const cleanData = { ...data };
	delete cleanData.id;
	delete cleanData.createdAt;
	delete cleanData.updatedAt;

	switch (type) {
		case 'Account':
			delete cleanData.debitTransactions;
			delete cleanData.creditTransactions;
			delete cleanData.rules;
			delete cleanData.balanceRecords;
			delete cleanData.taxCategory;
			await tx.account.update({
				where: { id },
				data: cleanData as Prisma.AccountUncheckedUpdateInput
			});
			break;
		case 'Transaction':
			delete cleanData.debitAccount;
			delete cleanData.creditAccount;
			delete cleanData.mergedInto;
			delete cleanData.mergedFrom;
			delete cleanData.dismissedDupes1;
			delete cleanData.dismissedDupes2;
			await tx.transaction.update({
				where: { id },
				data: cleanData as Prisma.TransactionUncheckedUpdateInput
			});
			break;
		case 'Rule':
			delete cleanData.account;
			await tx.rule.update({
				where: { id },
				data: cleanData as Prisma.RuleUncheckedUpdateInput
			});
			break;
		case 'TaxCategory':
			delete cleanData.accounts;
			await tx.taxCategory.update({
				where: { id },
				data: cleanData as Prisma.TaxCategoryUncheckedUpdateInput
			});
			break;
		case 'BalanceRecord':
			delete cleanData.account;
			await tx.balanceRecord.update({
				where: { id },
				data: cleanData as Prisma.BalanceRecordUncheckedUpdateInput
			});
			break;
		case 'DismissedDuplicate':
			delete cleanData.tx1;
			delete cleanData.tx2;
			await tx.dismissedDuplicate.update({
				where: { id },
				data: cleanData as Prisma.DismissedDuplicateUncheckedUpdateInput
			});
			break;
		case 'TaxDocument':
			delete cleanData.lines;
			delete cleanData.account;
			await tx.taxDocument.update({ where: { id }, data: cleanData as Prisma.TaxDocumentUncheckedUpdateInput });
			break;
		case 'TaxDocumentLine':
			delete cleanData.document;
			delete cleanData.taxCategory;
			await tx.taxDocumentLine.update({ where: { id }, data: cleanData as Prisma.TaxDocumentLineUncheckedUpdateInput });
			break;
		case 'TaxFact':
			await tx.taxFact.update({ where: { id }, data: cleanData as Prisma.TaxFactUncheckedUpdateInput });
			break;
	}
}

export async function undoOperation(logId: string): Promise<UndoResult> {
	const log = await db.operationLog.findUniqueOrThrow({ where: { id: logId } });
	if (log.operation === 'IMPORT') throw new Error('Import operations cannot be undone');

	const changes = log.changes as unknown as Change[];
	const reversedChanges: Change[] = [];
	let undone = 0,
		skipped = 0;

	await db.$transaction(async (tx) => {
		for (const change of changes) {
			const exists = await entityExists(tx, change.entityType, change.entityId);

			if (change.before === null) {
				// Was CREATE - delete if exists
				if (exists) {
					await deleteEntity(tx, change.entityType, change.entityId);
					reversedChanges.push({ ...change, before: change.after, after: null });
					undone++;
				} else {
					skipped++;
				}
			} else if (change.after === null) {
				// Was DELETE - recreate if not exists
				if (!exists) {
					await recreateEntity(tx, change.entityType, change.before);
					reversedChanges.push({ ...change, before: null, after: change.before });
					undone++;
				} else {
					skipped++;
				}
			} else {
				// Was UPDATE - apply before values if exists
				if (exists) {
					await updateEntity(tx, change.entityType, change.entityId, change.before);
					reversedChanges.push({ ...change, before: change.after, after: change.before });
					undone++;
				} else {
					skipped++;
				}
			}
		}
	});

	if (undone > 0) {
		// Mark original operation as undone
		await db.operationLog.update({
			where: { id: logId },
			data: { undoneAt: new Date() }
		});

		await logOperation(log.bookId, 'UNDO', `Undo: ${log.description}`, reversedChanges);
	}

	return { undone, skipped };
}
