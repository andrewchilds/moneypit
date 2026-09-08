import { db } from '../db';
import { getEnabledModules } from './taxModules';
import { listTaxFacts } from './taxFacts';
import { listTaxDocuments } from './taxDocuments';
import type { FactValue, TaxQuestion } from '../taxModules';

export interface QuestionStatus extends TaxQuestion {
	moduleId: string;
	answer: FactValue | null;
	answered: boolean;
	/** False when a dependsOn condition isn't met */
	visible: boolean;
	/** Year the answer came from: the year itself, or null for carry-forward */
	answerYear: number | null;
}

export type ExpectedDocumentStatus = 'received' | 'not_applicable' | 'missing';

export interface ExpectedDocument {
	formType: string;
	/** Institution or employer expected to issue it */
	institution: string;
	reason: string;
	accountIds: string[];
	status: ExpectedDocumentStatus;
	documentId: string | null;
}

export type TaxDocumentWithLines = Awaited<ReturnType<typeof listTaxDocuments>>[number];

export interface TaxYearStatus {
	year: number;
	modules: { moduleId: string; name: string; questions: QuestionStatus[] }[];
	documents: TaxDocumentWithLines[];
	expectedDocuments: ExpectedDocument[];
	openQuestions: number;
	missingDocuments: number;
}

/**
 * Everything that needs answering for a tax year: the questions declared by
 * enabled modules with their answers, the documents on hand, and the
 * documents the books suggest should exist.
 */
export async function getTaxYearStatus(bookId: string, year: number): Promise<TaxYearStatus> {
	const [enabled, facts, documents] = await Promise.all([
		getEnabledModules(bookId),
		listTaxFacts(bookId, year),
		listTaxDocuments(bookId, year)
	]);

	// Year-specific facts win over carry-forward facts
	const factMap = new Map<string, { value: FactValue; year: number | null }>();
	for (const fact of facts) {
		const current = factMap.get(fact.key);
		if (!current || (current.year === null && fact.year === year)) {
			factMap.set(fact.key, { value: fact.value as FactValue, year: fact.year });
		}
	}

	const modules = enabled.map((e) => ({
		moduleId: e.moduleId,
		name: e.module.name,
		questions: (e.module.questions ?? []).map((q): QuestionStatus => {
			const fact = factMap.get(q.key);
			const visible = !q.dependsOn || factMap.get(q.dependsOn.key)?.value === q.dependsOn.value;
			return {
				...q,
				moduleId: e.moduleId,
				answer: fact?.value ?? null,
				answered: fact !== undefined,
				visible,
				answerYear: fact?.year ?? null
			};
		})
	}));

	const expected = await inferExpectedDocuments(bookId, year);
	for (const e of enabled) {
		for (const rule of e.module.expectedDocuments ?? []) {
			if (factMap.get(rule.whenFact.key)?.value === rule.whenFact.value) {
				expected.push({ formType: rule.formType, institution: '', reason: rule.reason, accountIds: [] });
			}
		}
	}

	const expectedDocuments = expected.map((exp) => {
		const match = documents.find((d) => d.formType === exp.formType && matchesInstitution(d, exp));
		return {
			...exp,
			status: (match ? (match.status === 'RECEIVED' ? 'received' : 'not_applicable') : 'missing') as ExpectedDocumentStatus,
			documentId: match?.id ?? null
		};
	});

	const openQuestions = modules.reduce((n, m) => n + m.questions.filter((q) => q.visible && !q.answered).length, 0);
	const missingDocuments = expectedDocuments.filter((d) => d.status === 'missing').length;

	return { year, modules, documents, expectedDocuments, openQuestions, missingDocuments };
}

type ExpectedDocumentDraft = Omit<ExpectedDocument, 'status' | 'documentId'>;

function matchesInstitution(doc: { issuer: string; accountId: string | null }, exp: ExpectedDocumentDraft): boolean {
	if (exp.accountIds.length > 0 && doc.accountId && exp.accountIds.includes(doc.accountId)) return true;
	if (!exp.institution) return true;
	const a = doc.issuer.toLowerCase();
	const b = exp.institution.toLowerCase();
	return a === b || a.includes(b) || b.includes(a);
}

/** "Ally:Checking" -> "Ally" */
function institutionOf(path: string): string {
	return path.split(':')[0];
}

const RETIREMENT = new Set(['ROTH_RETIREMENT', 'TAX_DEFERRED']);

/**
 * Work out which forms the books imply from the year's transactions:
 * interest and dividends received imply 1099-INT and 1099-DIV, sales from a
 * brokerage imply a 1099-B, retirement withdrawals imply a 1099-R, and
 * mortgage interest paid implies a 1098.
 */
async function inferExpectedDocuments(bookId: string, year: number): Promise<ExpectedDocumentDraft[]> {
	const startDate = new Date(year, 0, 1);
	const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

	const txs = await db.transaction.findMany({
		where: { bookId, date: { gte: startDate, lte: endDate }, mergedIntoId: null },
		select: {
			debitAccount: { select: { id: true, type: true, assetType: true, path: true, taxCategory: { select: { name: true, scheduleRef: true } } } },
			creditAccount: { select: { id: true, type: true, assetType: true, path: true, taxCategory: { select: { name: true, scheduleRef: true } } } }
		}
	});

	// key: formType|institution
	const drafts = new Map<string, ExpectedDocumentDraft>();
	const add = (formType: string, institution: string, reason: string, accountId: string) => {
		const key = `${formType}|${institution.toLowerCase()}`;
		const existing = drafts.get(key);
		if (existing) {
			if (!existing.accountIds.includes(accountId)) existing.accountIds.push(accountId);
		} else {
			drafts.set(key, { formType, institution, reason, accountIds: [accountId] });
		}
	};

	for (const tx of txs) {
		const dr = tx.debitAccount;
		const cr = tx.creditAccount;
		if (!dr || !cr) continue;

		// Income landing in a non-retirement asset account
		if (dr.type === 'ASSET' && cr.type === 'INCOME' && !RETIREMENT.has(dr.assetType ?? '')) {
			const cat = `${cr.taxCategory?.name ?? ''} ${cr.taxCategory?.scheduleRef ?? ''}`;
			if (/interest/i.test(cat) && !/tax exempt/i.test(cat)) {
				add('1099-INT', institutionOf(dr.path), `Interest received in ${dr.path}`, dr.id);
			} else if (/dividend/i.test(cat)) {
				add('1099-DIV', institutionOf(dr.path), `Dividends received in ${dr.path}`, dr.id);
			}
		}

		// Money leaving a brokerage account: a sale was likely reported
		if (cr.type === 'ASSET' && cr.assetType === 'BROKERAGE' && dr.type === 'ASSET') {
			add('1099-B', institutionOf(cr.path), `Withdrawal from ${cr.path}`, cr.id);
		}

		// Money leaving a retirement account to a non-retirement account: a distribution
		if (cr.type === 'ASSET' && RETIREMENT.has(cr.assetType ?? '') && !(dr.type === 'ASSET' && RETIREMENT.has(dr.assetType ?? ''))) {
			add('1099-R', institutionOf(cr.path), `Distribution from ${cr.path}`, cr.id);
		}

		// Mortgage interest paid
		if (dr.type === 'EXPENSE' && /mortgage interest/i.test(dr.taxCategory?.name ?? '')) {
			add('1098', institutionOf(dr.path), `Mortgage payments from ${dr.path}`, dr.id);
		}
	}

	return Array.from(drafts.values()).sort((a, b) => a.formType.localeCompare(b.formType) || a.institution.localeCompare(b.institution));
}
