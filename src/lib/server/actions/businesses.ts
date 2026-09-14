import { db } from '../db';
import type { Business } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';
import { perBusinessSchedules, scheduleOf, taxModules } from '../taxModules';

export type { Business };

export interface BusinessWithCounts extends Business {
	accountCount: number;
}

/**
 * An account attached to a business with the percentage of it the business
 * claims: 100 for an account that is wholly the business's, less for a
 * personal account used partly for it. An account can be attached to
 * several businesses.
 */
export interface BusinessAccountLink {
	id: string;
	businessId: string;
	accountId: string;
	percent: number;
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

/** Every account-business link in the book */
export async function listBusinessAccounts(bookId: string): Promise<BusinessAccountLink[]> {
	const rows = await db.businessAccount.findMany({
		where: { business: { bookId } },
		orderBy: [{ business: { createdAt: 'asc' } }, { account: { path: 'asc' } }]
	});
	return rows.map((r) => ({ id: r.id, businessId: r.businessId, accountId: r.accountId, percent: Number(r.percent) }));
}

/** The businesses an account is attached to, with the percentage of each */
export async function listAccountBusinesses(accountId: string): Promise<BusinessAccountLink[]> {
	const rows = await db.businessAccount.findMany({ where: { accountId }, orderBy: { business: { createdAt: 'asc' } } });
	return rows.map((r) => ({ id: r.id, businessId: r.businessId, accountId: r.accountId, percent: Number(r.percent) }));
}

function checkPercent(percent: number): void {
	if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
		throw new Error(`Percentage must be more than 0 and at most 100, got ${percent}`);
	}
}

/**
 * Attach an account to a business at a percentage, or change the percentage
 * of an existing attachment.
 */
export async function setBusinessAccount(businessId: string, accountId: string, percent: number): Promise<BusinessAccountLink> {
	checkPercent(percent);
	const [business, account] = await Promise.all([
		db.business.findUnique({ where: { id: businessId } }),
		db.account.findUnique({ where: { id: accountId } })
	]);
	if (!business) throw new Error('Business not found');
	if (!account || account.bookId !== business.bookId) throw new Error('Account not found in this book');
	if (account.type !== 'INCOME' && account.type !== 'EXPENSE') {
		throw new Error('Only income and expense accounts can be attached to a business');
	}

	const existing = await db.businessAccount.findUnique({ where: { businessId_accountId: { businessId, accountId } } });
	const label = `${account.path} -> ${business.name} at ${percent}%`;
	if (existing) {
		if (Number(existing.percent) === percent) return toLink(existing);
		const result = await db.businessAccount.update({ where: { id: existing.id }, data: { percent } });
		const { before, after } = diff(serialize(existing), serialize(result));
		await logOperation(business.bookId, 'UPDATE', `Changed business share: ${label}`, [
			{ entityType: 'BusinessAccount', entityId: existing.id, before, after }
		]);
		return toLink(result);
	}
	const result = await db.businessAccount.create({ data: { businessId, accountId, percent } });
	await logOperation(business.bookId, 'CREATE', `Attached account to business: ${label}`, [
		{ entityType: 'BusinessAccount', entityId: result.id, before: null, after: serialize(result) }
	]);
	return toLink(result);
}

/** Detach an account from a business. Nothing happens if it was not attached. */
export async function removeBusinessAccount(businessId: string, accountId: string): Promise<void> {
	const existing = await db.businessAccount.findUnique({
		where: { businessId_accountId: { businessId, accountId } },
		include: { business: { select: { bookId: true, name: true } }, account: { select: { path: true } } }
	});
	if (!existing) return;
	await db.businessAccount.delete({ where: { id: existing.id } });
	const { business, account, ...row } = existing;
	await logOperation(business.bookId, 'DELETE', `Detached account from business: ${account.path} -/-> ${business.name}`, [
		{ entityType: 'BusinessAccount', entityId: existing.id, before: serialize(row), after: null }
	]);
}

/**
 * Replace an account's attachments with the given list: businesses not in
 * the list are detached, the rest attached or updated to their percentage.
 */
export async function setAccountBusinesses(accountId: string, links: { businessId: string; percent: number }[]): Promise<void> {
	for (const l of links) checkPercent(l.percent);
	const current = await db.businessAccount.findMany({ where: { accountId } });
	const wanted = new Map(links.map((l) => [l.businessId, l.percent]));
	for (const c of current) {
		if (!wanted.has(c.businessId)) await removeBusinessAccount(c.businessId, accountId);
	}
	for (const [businessId, percent] of wanted) await setBusinessAccount(businessId, accountId, percent);
}

/**
 * The "business:<id>" fields of the account form: a percentage per
 * business, blank when the account is not attached to it.
 */
export function businessSharesFromForm(data: FormData): { businessId: string; percent: number }[] {
	const links: { businessId: string; percent: number }[] = [];
	for (const [name, value] of data.entries()) {
		if (!name.startsWith('business:') || String(value).trim() === '') continue;
		links.push({ businessId: name.slice('business:'.length), percent: Number(value) });
	}
	return links;
}

function toLink(row: { id: string; businessId: string; accountId: string; percent: unknown }): BusinessAccountLink {
	return { id: row.id, businessId: row.businessId, accountId: row.accountId, percent: Number(row.percent) };
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
 * on a per-business schedule (attached in full), and answers to per-business
 * questions that were stored without a business.
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
			where: { bookId, taxCategoryId: { not: null }, businesses: { none: {} } },
			include: { taxCategory: { select: { scheduleRef: true } } }
		});
		const toAdopt = accounts.filter((a) => {
			const schedule = scheduleOf(a.taxCategory?.scheduleRef ?? null);
			return schedule !== null && schedules.has(schedule);
		});
		if (toAdopt.length > 0) {
			await db.businessAccount.createMany({
				data: toAdopt.map((a) => ({ businessId: business.id, accountId: a.id, percent: 100 }))
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
 * Delete a business. Its accounts are detached and its documents kept
 * without a business; its answers are deleted with it.
 */
export async function deleteBusiness(id: string): Promise<void> {
	const before = await db.business.findUniqueOrThrow({ where: { id } });
	const [facts, links] = await Promise.all([
		db.taxFact.findMany({ where: { businessId: id } }),
		db.businessAccount.findMany({ where: { businessId: id } })
	]);
	await db.business.delete({ where: { id } });
	// The business first, so an undo recreates it before what points at it
	await logOperation(before.bookId, 'DELETE', `Deleted business: ${before.name}`, [
		{ entityType: 'Business', entityId: id, before: serialize(before), after: null },
		...facts.map((f) => ({ entityType: 'TaxFact' as const, entityId: f.id, before: serialize(f), after: null })),
		...links.map((l) => ({ entityType: 'BusinessAccount' as const, entityId: l.id, before: serialize(l), after: null }))
	]);
}
