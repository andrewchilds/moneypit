import { db } from '../db';
import type { Prisma } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';
import { findQuestion } from '../taxModules';
import type { AccountShare, FactValue, TaxQuestionType } from '../taxModules';

export type { FactValue };

/**
 * List facts for a book. With a year, returns that year's facts plus the
 * carry-forward facts (year null).
 */
export async function listTaxFacts(bookId: string, year?: number) {
	return db.taxFact.findMany({
		where: {
			bookId,
			...(year !== undefined ? { OR: [{ year }, { year: null }] } : {})
		},
		orderBy: [{ key: 'asc' }, { year: 'desc' }]
	});
}

/**
 * The fact for a key in a year, falling back to the carry-forward value.
 * Per-business questions are looked up for the given business.
 */
export async function getTaxFact(bookId: string, year: number, key: string, businessId: string | null = null) {
	const facts = await db.taxFact.findMany({
		where: { bookId, key, businessId, OR: [{ year }, { year: null }] }
	});
	return facts.find((f) => f.year === year) ?? facts.find((f) => f.year === null) ?? null;
}

/**
 * A per-business question must name a business once the book has any;
 * other questions must not. Unknown keys accept either.
 */
async function checkBusinessScope(bookId: string, key: string, businessId: string | null): Promise<void> {
	const found = findQuestion(key);
	if (!found) return;
	if (found.module.perBusiness) {
		if (businessId) {
			const business = await db.business.findUnique({ where: { id: businessId } });
			if (!business || business.bookId !== bookId) throw new Error('Business not found in this book');
		} else if ((await db.business.count({ where: { bookId } })) > 0) {
			throw new Error(`${key} is answered per business; specify which business`);
		}
	} else if (businessId) {
		throw new Error(`${key} is not a per-business question`);
	}
}

/** An `accounts` or `account_shares` answer must list accounts of this book. */
async function checkAccountIds(bookId: string, value: FactValue): Promise<void> {
	if (!Array.isArray(value)) throw new Error('Expected a list of account ids');
	const ids = value.map((v) => (typeof v === 'string' ? v : v.id));
	const found = await db.account.findMany({ where: { bookId, id: { in: ids } }, select: { id: true } });
	const known = new Set(found.map((a) => a.id));
	const missing = ids.filter((id) => !known.has(id));
	if (missing.length > 0) throw new Error(`Account not found in this book: ${missing.join(', ')}`);
}

function describe(key: string, year: number | null, business: { name: string } | null): string {
	return `${key}${business ? ` (${business.name})` : ''}${year ? ` for ${year}` : ''}`;
}

/**
 * Set a fact. If the key belongs to a carry-forward question, it is stored
 * without a year regardless of the year passed.
 */
export async function setTaxFact(
	bookId: string,
	key: string,
	value: FactValue,
	year: number | null,
	businessId: string | null = null
) {
	const question = findQuestion(key)?.question;
	const effectiveYear = question?.carryForward ? null : year;
	await checkBusinessScope(bookId, key, businessId);
	if (question?.type === 'accounts' || question?.type === 'account_shares') await checkAccountIds(bookId, value);

	const existing = await db.taxFact.findFirst({
		where: { bookId, key, year: effectiveYear, businessId },
		include: { business: { select: { name: true } } }
	});
	const jsonValue = value as Prisma.InputJsonValue;

	if (existing) {
		const { business, ...previous } = existing;
		const result = await db.taxFact.update({ where: { id: existing.id }, data: { value: jsonValue } });
		const { before, after } = diff(serialize(previous), serialize(result));
		if (Object.keys(before).length > 0) {
			await logOperation(bookId, 'UPDATE', `Updated tax fact ${describe(key, effectiveYear, business)}`, [
				{ entityType: 'TaxFact', entityId: result.id, before, after }
			]);
		}
		return result;
	}

	const result = await db.taxFact.create({
		data: { bookId, key, year: effectiveYear, value: jsonValue, businessId },
		include: { business: { select: { name: true } } }
	});
	const { business, ...created } = result;
	await logOperation(bookId, 'CREATE', `Set tax fact ${describe(key, effectiveYear, business)}`, [
		{ entityType: 'TaxFact', entityId: result.id, before: null, after: serialize(created) }
	]);
	return created;
}

export async function deleteTaxFact(bookId: string, key: string, year: number | null, businessId: string | null = null) {
	const question = findQuestion(key)?.question;
	const effectiveYear = question?.carryForward ? null : year;
	const existing = await db.taxFact.findFirst({ where: { bookId, key, year: effectiveYear, businessId } });
	if (!existing) throw new Error(`Fact not found: ${describe(key, effectiveYear, null)}`);
	await db.taxFact.delete({ where: { id: existing.id } });
	await logOperation(bookId, 'DELETE', `Deleted tax fact ${key}`, [
		{ entityType: 'TaxFact', entityId: existing.id, before: serialize(existing), after: null }
	]);
}

/**
 * Parse a raw string (from the CLI or a form) into a fact value using the
 * question's type. Unknown keys accept JSON, then fall back to the raw string.
 */
export function parseFactValue(raw: string, type?: TaxQuestionType, options?: { value: string }[]): FactValue {
	const trimmed = raw.trim();
	switch (type) {
		case 'boolean': {
			const lower = trimmed.toLowerCase();
			if (['true', 'yes', 'y', '1'].includes(lower)) return true;
			if (['false', 'no', 'n', '0'].includes(lower)) return false;
			throw new Error(`Expected yes/no, got "${raw}"`);
		}
		case 'amount':
		case 'number': {
			const n = parseFloat(trimmed.replace(/[$,]/g, ''));
			if (Number.isNaN(n)) throw new Error(`Expected a number, got "${raw}"`);
			return n;
		}
		case 'date': {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new Error(`Expected a date as YYYY-MM-DD, got "${raw}"`);
			return trimmed;
		}
		case 'choice': {
			if (options && !options.some((o) => o.value === trimmed)) {
				throw new Error(`Expected one of ${options.map((o) => o.value).join(', ')}, got "${raw}"`);
			}
			return trimmed;
		}
		case 'text':
			return trimmed;
		case 'accounts': {
			const ids = trimmed.split(/[\s,]+/).filter(Boolean);
			if (ids.length === 0) throw new Error('Expected one or more account ids');
			return ids;
		}
		case 'account_shares': {
			// "id:50,id2:40" — an account id and the percentage of it claimed
			const shares: AccountShare[] = [];
			for (const entry of trimmed.split(/[\s,]+/).filter(Boolean)) {
				const [id, rest, ...extra] = entry.split(':');
				const percent = Number(rest?.replace('%', ''));
				if (!id || rest === undefined || extra.length > 0 || !Number.isFinite(percent)) {
					throw new Error(`Expected <account-id>:<percent> entries, got "${entry}"`);
				}
				if (percent < 0 || percent > 100) throw new Error(`Percentage must be between 0 and 100, got "${entry}"`);
				shares.push({ id, percent });
			}
			if (shares.length === 0) throw new Error('Expected one or more <account-id>:<percent> entries');
			return shares;
		}
		default: {
			if (['true', 'false'].includes(trimmed.toLowerCase())) return trimmed.toLowerCase() === 'true';
			const n = Number(trimmed);
			if (trimmed !== '' && !Number.isNaN(n)) return n;
			return trimmed;
		}
	}
}
