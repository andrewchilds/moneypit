import { db } from '../db';
import type { Prisma } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';
import { findQuestion } from '../taxModules';
import type { FactValue, TaxQuestionType } from '../taxModules';

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

/** The fact for a key in a year, falling back to the carry-forward value. */
export async function getTaxFact(bookId: string, year: number, key: string) {
	const facts = await db.taxFact.findMany({
		where: { bookId, key, OR: [{ year }, { year: null }] }
	});
	return facts.find((f) => f.year === year) ?? facts.find((f) => f.year === null) ?? null;
}

/**
 * Set a fact. If the key belongs to a carry-forward question, it is stored
 * without a year regardless of the year passed.
 */
export async function setTaxFact(bookId: string, key: string, value: FactValue, year: number | null) {
	const question = findQuestion(key)?.question;
	const effectiveYear = question?.carryForward ? null : year;

	const existing = await db.taxFact.findFirst({ where: { bookId, key, year: effectiveYear } });
	const jsonValue = value as Prisma.InputJsonValue;

	if (existing) {
		const result = await db.taxFact.update({ where: { id: existing.id }, data: { value: jsonValue } });
		const { before, after } = diff(serialize(existing), serialize(result));
		if (Object.keys(before).length > 0) {
			await logOperation(bookId, 'UPDATE', `Updated tax fact ${key}${effectiveYear ? ` for ${effectiveYear}` : ''}`, [
				{ entityType: 'TaxFact', entityId: result.id, before, after }
			]);
		}
		return result;
	}

	const result = await db.taxFact.create({ data: { bookId, key, year: effectiveYear, value: jsonValue } });
	await logOperation(bookId, 'CREATE', `Set tax fact ${key}${effectiveYear ? ` for ${effectiveYear}` : ''}`, [
		{ entityType: 'TaxFact', entityId: result.id, before: null, after: serialize(result) }
	]);
	return result;
}

export async function deleteTaxFact(bookId: string, key: string, year: number | null) {
	const question = findQuestion(key)?.question;
	const effectiveYear = question?.carryForward ? null : year;
	const existing = await db.taxFact.findFirst({ where: { bookId, key, year: effectiveYear } });
	if (!existing) throw new Error(`Fact not found: ${key}${effectiveYear ? ` for ${effectiveYear}` : ''}`);
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
		default: {
			if (['true', 'false'].includes(trimmed.toLowerCase())) return trimmed.toLowerCase() === 'true';
			const n = Number(trimmed);
			if (trimmed !== '' && !Number.isNaN(n)) return n;
			return trimmed;
		}
	}
}
