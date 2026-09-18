import { db } from '../db';
import { getEnabledModules } from './taxModules';
import { listTaxFacts } from './taxFacts';
import { listTaxDocuments } from './taxDocuments';
import { getTaxAccountTotals, bookFigureForAccount, type OverlayRow } from './taxTotals';
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
	/** Business the form belongs to, when expected because of a per-business answer */
	businessId: string | null;
	status: ExpectedDocumentStatus;
	documentId: string | null;
}

export type TaxDocumentWithLines = Awaited<ReturnType<typeof listTaxDocuments>>[number];

export type ReconciliationStatus = 'matched' | 'variance' | 'no_transactions';

/**
 * A document line compared to the books: the figure the document reports
 * for its account and category against the transactions of that account
 * in that category.
 */
export interface DocumentReconciliation {
	documentId: string;
	lineId: string;
	box: string;
	label: string;
	taxCategoryId: string;
	taxCategoryName: string;
	accountId: string;
	accountPath: string;
	bookAmount: number;
	documentAmount: number;
	/** document minus books */
	difference: number;
	status: ReconciliationStatus;
}

/**
 * A received document tied to no account. Each of its mapped lines replaces
 * the whole of its category on the tax report, so the book activity listed
 * here (every account's total in that category this year) is dropped unless
 * other documents put it back.
 */
export interface UntiedDocument {
	documentId: string;
	categories: {
		taxCategoryId: string;
		taxCategoryName: string;
		/** The document's figure for the category */
		documentAmount: number;
		/** The book total the document replaces */
		bookTotal: number;
		accounts: { id: string; path: string; total: number }[];
	}[];
}

/**
 * One questionnaire: a module's questions, for one business when the module
 * is per-business and the book has businesses.
 */
export interface ModuleStatus {
	moduleId: string;
	name: string;
	businessId: string | null;
	businessName: string | null;
	questions: QuestionStatus[];
}

export interface TaxYearStatus {
	year: number;
	businesses: { id: string; name: string }[];
	modules: ModuleStatus[];
	documents: TaxDocumentWithLines[];
	expectedDocuments: ExpectedDocument[];
	/** One per mapped line of each received document tied to an account */
	reconciliations: DocumentReconciliation[];
	/** Received documents tied to no account, with the book activity their lines replace */
	untied: UntiedDocument[];
	openQuestions: number;
	missingDocuments: number;
}

/**
 * Everything that needs answering for a tax year: the questions declared by
 * enabled modules with their answers, the documents on hand, and the
 * documents the books suggest should exist.
 */
export async function getTaxYearStatus(bookId: string, year: number): Promise<TaxYearStatus> {
	const [enabled, facts, documents, businesses, { reconciliations, untied }] = await Promise.all([
		getEnabledModules(bookId),
		listTaxFacts(bookId, year),
		listTaxDocuments(bookId, year),
		db.business.findMany({ where: { bookId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
		compareDocuments(bookId, year)
	]);

	// Year-specific facts win over carry-forward facts. Keyed by business
	// (null for book-level answers) then question key.
	type Answer = { value: FactValue; year: number | null };
	const factMaps = new Map<string | null, Map<string, Answer>>();
	const answersFor = (businessId: string | null): Map<string, Answer> => {
		let map = factMaps.get(businessId);
		if (!map) {
			map = new Map();
			factMaps.set(businessId, map);
		}
		return map;
	};
	for (const fact of facts) {
		const map = answersFor(fact.businessId);
		const current = map.get(fact.key);
		if (!current || (current.year === null && fact.year === year)) {
			map.set(fact.key, { value: fact.value as FactValue, year: fact.year });
		}
	}

	const dependencyMet = (dep: NonNullable<TaxQuestion['dependsOn']>, answer: FactValue | undefined): boolean => {
		if ('min' in dep) return typeof answer === 'number' ? answer >= dep.min : typeof answer === 'string' && Number(answer) >= dep.min;
		return answer === dep.value;
	};

	// Per-business modules are asked once per business. A book with no
	// businesses treats itself as one implicit business (businessId null).
	const scopes: { businessId: string | null; businessName: string | null }[] =
		businesses.length > 0
			? businesses.map((b) => ({ businessId: b.id, businessName: b.name }))
			: [{ businessId: null, businessName: null }];

	const modules: ModuleStatus[] = enabled.flatMap((e) => {
		const moduleScopes = e.module.perBusiness ? scopes : [{ businessId: null, businessName: null }];
		return moduleScopes.map((scope) => {
			const answers = answersFor(scope.businessId);
			return {
				moduleId: e.moduleId,
				name: e.module.name,
				businessId: scope.businessId,
				businessName: scope.businessName,
				questions: (e.module.questions ?? []).map((q): QuestionStatus => {
					const fact = answers.get(q.key);
					const visible = !q.dependsOn || dependencyMet(q.dependsOn, answers.get(q.dependsOn.key)?.value);
					return {
						...q,
						moduleId: e.moduleId,
						answer: fact?.value ?? null,
						answered: fact !== undefined,
						visible,
						answerYear: fact?.year ?? null
					};
				})
			};
		});
	});

	const expected = await inferExpectedDocuments(bookId, year);
	for (const m of modules) {
		const module = enabled.find((e) => e.moduleId === m.moduleId)!.module;
		const answers = answersFor(m.businessId);
		for (const rule of module.expectedDocuments ?? []) {
			if (answers.get(rule.whenFact.key)?.value === rule.whenFact.value) {
				expected.push({
					formType: rule.formType,
					institution: '',
					reason: m.businessName ? `${rule.reason} (${m.businessName})` : rule.reason,
					accountIds: [],
					businessId: m.businessId
				});
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

	return { year, businesses, modules, documents, expectedDocuments, reconciliations, untied, openQuestions, missingDocuments };
}

/**
 * Compare each received document with the books. A document tied to an
 * account gets a reconciliation per mapped line: the transactions of that
 * account in the line's category against the figure. A document tied to no
 * account is listed as untied, with the whole-category book activity each of
 * its mapped lines replaces.
 */
export async function compareDocuments(bookId: string, year: number): Promise<{ reconciliations: DocumentReconciliation[]; untied: UntiedDocument[] }> {
	const [documents, totals, accounts] = await Promise.all([
		db.taxDocument.findMany({
			where: { bookId, year, status: 'RECEIVED' },
			include: {
				account: { select: { id: true, path: true } },
				lines: { where: { taxCategoryId: { not: null } }, include: { taxCategory: { select: { id: true, name: true } } }, orderBy: { box: 'asc' } }
			},
			orderBy: [{ formType: 'asc' }, { issuer: 'asc' }]
		}),
		getTaxAccountTotals(bookId, year),
		db.account.findMany({ where: { bookId }, select: { id: true, path: true, type: true, taxCategoryId: true } })
	]);

	// Counterparty rows of every account, grouped by the account's category
	const accountById = new Map(accounts.map((a) => [a.id, a]));
	const rowsByCategory = new Map<string, OverlayRow[]>();
	for (const t of totals) {
		const account = accountById.get(t.accountId);
		const categoryId = account?.type === 'INCOME' || account?.type === 'EXPENSE' ? account.taxCategoryId : null;
		if (!categoryId) continue;
		const rows = rowsByCategory.get(categoryId) ?? [];
		rows.push({ accountId: t.accountId, counterpartyId: t.counterpartyId, total: t.total });
		rowsByCategory.set(categoryId, rows);
	}

	const reconciliations: DocumentReconciliation[] = [];
	const untied: UntiedDocument[] = [];
	for (const doc of documents) {
		if (!doc.account) {
			if (doc.lines.length === 0) continue;
			// One entry per category the lines land on, the book side summed per
			// counterparty (the asset account the money moved through, which is
			// what a document gets tied to; the category's own account when the
			// other side is still uncategorized)
			const categories = new Map<string, UntiedDocument['categories'][number]>();
			for (const line of doc.lines) {
				if (!line.taxCategory) continue;
				let entry = categories.get(line.taxCategory.id);
				if (!entry) {
					const perAccount = new Map<string, number>();
					for (const row of rowsByCategory.get(line.taxCategory.id) ?? []) {
						const id = row.counterpartyId ?? row.accountId;
						perAccount.set(id, (perAccount.get(id) ?? 0) + row.total);
					}
					const accountRows = Array.from(perAccount, ([id, total]) => ({ id, path: accountById.get(id)?.path ?? id, total: round2(total) }))
						.filter((a) => a.total !== 0)
						.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
					entry = {
						taxCategoryId: line.taxCategory.id,
						taxCategoryName: line.taxCategory.name,
						documentAmount: 0,
						bookTotal: round2(accountRows.reduce((sum, a) => sum + a.total, 0)),
						accounts: accountRows
					};
					categories.set(line.taxCategory.id, entry);
				}
				entry.documentAmount = round2(entry.documentAmount + Number(line.amount));
			}
			// A box at zero on a category the books have nothing in changes nothing
			untied.push({ documentId: doc.id, categories: Array.from(categories.values()).filter((c) => c.documentAmount !== 0 || c.bookTotal !== 0) });
			continue;
		}
		for (const line of doc.lines) {
			if (!line.taxCategory) continue;
			const book = bookFigureForAccount(rowsByCategory.get(line.taxCategory.id) ?? [], doc.account.id);
			const documentAmount = Number(line.amount);
			const difference = round2(documentAmount - book.amount);
			reconciliations.push({
				documentId: doc.id,
				lineId: line.id,
				box: line.box,
				label: line.label,
				taxCategoryId: line.taxCategory.id,
				taxCategoryName: line.taxCategory.name,
				accountId: doc.account.id,
				accountPath: doc.account.path,
				bookAmount: book.amount,
				documentAmount,
				difference,
				status: !book.hasRows ? 'no_transactions' : Math.abs(difference) < 0.01 ? 'matched' : 'variance'
			});
		}
	}
	return { reconciliations, untied };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type ExpectedDocumentDraft = Omit<ExpectedDocument, 'status' | 'documentId'>;

function matchesInstitution(
	doc: { issuer: string; accountId: string | null; businessId: string | null },
	exp: ExpectedDocumentDraft
): boolean {
	// A document filed under a different business can't satisfy this expectation
	if (exp.businessId && doc.businessId && doc.businessId !== exp.businessId) return false;
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
			drafts.set(key, { formType, institution, reason, accountIds: [accountId], businessId: null });
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
