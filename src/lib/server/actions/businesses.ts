import { db } from '../db';
import type { Business } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';
import { perBusinessSchedules, scheduleOf, taxModules } from '../taxModules';

export type { Business };

export interface BusinessWithCounts extends Business {
	accountCount: number;
}

export async function listBusinesses(bookId: string): Promise<BusinessWithCounts[]> {
	const rows = await db.business.findMany({
		where: { bookId },
		include: { _count: { select: { accounts: true } } },
		orderBy: { createdAt: 'asc' }
	});
	return rows.map(({ _count, ...b }) => ({ ...b, accountCount: _count.accounts }));
}

export async function getBusiness(id: string): Promise<Business | null> {
	return db.business.findUnique({ where: { id } });
}

/** Resolve a business by id, then by name (case-insensitive) within the book. */
export async function resolveBusiness(bookId: string, idOrName: string): Promise<Business> {
	const byId = await db.business.findUnique({ where: { id: idOrName } });
	if (byId && byId.bookId === bookId) return byId;
	const byName = await db.business.findFirst({
		where: { bookId, name: { equals: idOrName.trim(), mode: 'insensitive' } }
	});
	if (byName) return byName;
	throw new Error(`Business not found: ${idOrName}`);
}

export interface CreateBusinessResult {
	business: Business;
	/** Accounts and facts that belonged to the implicit single business and were moved to this one */
	adoptedAccounts: number;
	adoptedFacts: number;
}

/**
 * Create a business. The first business in a book adopts what the book was
 * treating as its single implicit business: accounts whose tax category is
 * on a per-business schedule, and answers to per-business questions that
 * were stored without a business.
 */
export async function createBusiness(bookId: string, name: string): Promise<CreateBusinessResult> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Business name is required');
	const existingCount = await db.business.count({ where: { bookId } });

	const business = await db.business.create({ data: { bookId, name: trimmed } });
	await logOperation(bookId, 'CREATE', `Created business: ${trimmed}`, [
		{ entityType: 'Business', entityId: business.id, before: null, after: serialize(business) }
	]);

	let adoptedAccounts = 0;
	let adoptedFacts = 0;
	if (existingCount === 0) {
		const schedules = perBusinessSchedules();
		const accounts = await db.account.findMany({
			where: { bookId, businessId: null, taxCategoryId: { not: null } },
			include: { taxCategory: { select: { scheduleRef: true } } }
		});
		const toAdopt = accounts.filter((a) => {
			const schedule = scheduleOf(a.taxCategory?.scheduleRef ?? null);
			return schedule !== null && schedules.has(schedule);
		});
		if (toAdopt.length > 0) {
			await db.account.updateMany({
				where: { id: { in: toAdopt.map((a) => a.id) } },
				data: { businessId: business.id }
			});
			adoptedAccounts = toAdopt.length;
		}

		const keys = taxModules.filter((m) => m.perBusiness).flatMap((m) => (m.questions ?? []).map((q) => q.key));
		if (keys.length > 0) {
			const result = await db.taxFact.updateMany({
				where: { bookId, businessId: null, key: { in: keys } },
				data: { businessId: business.id }
			});
			adoptedFacts = result.count;
		}
	}

	return { business, adoptedAccounts, adoptedFacts };
}

export async function updateBusiness(id: string, data: { name?: string }): Promise<Business> {
	const before = await db.business.findUniqueOrThrow({ where: { id } });
	const name = data.name?.trim();
	if (data.name !== undefined && !name) throw new Error('Business name is required');
	const result = await db.business.update({ where: { id }, data: { ...(name && { name }) } });
	const { before: beforeDiff, after: afterDiff } = diff(serialize(before), serialize(result));
	if (Object.keys(beforeDiff).length > 0) {
		await logOperation(result.bookId, 'UPDATE', `Updated business: ${result.name}`, [
			{ entityType: 'Business', entityId: id, before: beforeDiff, after: afterDiff }
		]);
	}
	return result;
}

/**
 * Delete a business. Its accounts and documents are kept and unassigned; its
 * answers are deleted with it.
 */
export async function deleteBusiness(id: string): Promise<void> {
	const before = await db.business.findUniqueOrThrow({ where: { id } });
	const facts = await db.taxFact.findMany({ where: { businessId: id } });
	await db.business.delete({ where: { id } });
	await logOperation(before.bookId, 'DELETE', `Deleted business: ${before.name}`, [
		...facts.map((f) => ({ entityType: 'TaxFact' as const, entityId: f.id, before: serialize(f), after: null })),
		{ entityType: 'Business', entityId: id, before: serialize(before), after: null }
	]);
}
