import { error, fail } from '@sveltejs/kit';
import { getTaxYearStatus } from '$lib/server/actions/taxYear';
import { setTaxFact, deleteTaxFact, parseFactValue } from '$lib/server/actions/taxFacts';
import {
	createTaxDocument,
	updateTaxDocument,
	deleteTaxDocument,
	addDocumentLine,
	deleteDocumentLine
} from '$lib/server/actions/taxDocuments';
import { listAccounts } from '$lib/server/actions/accounts';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import { findQuestion } from '$lib/server/taxModules';
import { FORM_PRESETS } from '$lib/taxForms';
import type { TaxDocumentStatus } from '@prisma/client';
import type { PageServerLoad, Actions } from './$types';

function parseYear(raw: string): number {
	const year = parseInt(raw, 10);
	if (!Number.isInteger(year) || year < 1990 || year > 2100) throw error(404, 'Invalid year');
	return year;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { bookId } = locals;
	const year = parseYear(params.year);

	const [status, accounts, taxCategories] = await Promise.all([
		getTaxYearStatus(bookId, year),
		listAccounts(bookId),
		listTaxCategories(bookId)
	]);

	const currentYear = new Date().getFullYear();

	return {
		status: {
			...status,
			// Decimal amounts can't cross the wire
			documents: status.documents.map((d) => ({
				...d,
				lines: d.lines.map((l) => ({ ...l, amount: Number(l.amount) }))
			}))
		},
		accounts: accounts.map((a) => ({ id: a.id, path: a.path, type: a.type })),
		taxCategories: taxCategories.map((c) => ({ id: c.id, name: c.name, scheduleRef: c.scheduleRef })),
		formPresets: FORM_PRESETS,
		availableYears: Array.from({ length: 6 }, (_, i) => currentYear - i)
	};
};

export const actions: Actions = {
	answer: async ({ params, request, locals }) => {
		const year = parseYear(params.year);
		const data = await request.formData();
		const key = (data.get('key') as string | null)?.trim();
		const raw = (data.get('value') as string | null) ?? '';
		if (!key) return fail(400, { error: 'Question key is required' });

		const question = findQuestion(key)?.question;
		try {
			if (raw.trim() === '') {
				await deleteTaxFact(locals.bookId, key, year).catch(() => undefined);
			} else {
				await setTaxFact(locals.bookId, key, parseFactValue(raw, question?.type, question?.options), year);
			}
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message, key });
		}
	},

	addDocument: async ({ params, request, locals }) => {
		const year = parseYear(params.year);
		const data = await request.formData();
		const formType = data.get('formType') as string;
		const issuer = data.get('issuer') as string;
		const accountId = (data.get('accountId') as string) || null;
		const notes = (data.get('notes') as string) || null;
		const status = ((data.get('status') as string) || 'RECEIVED') as TaxDocumentStatus;
		if (!formType?.trim() || !issuer?.trim()) return fail(400, { error: 'Form type and issuer are required' });

		try {
			const doc = await createTaxDocument(locals.bookId, { year, formType, issuer, accountId, notes, status });
			return { success: true, documentId: doc.id };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	setDocumentStatus: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const status = data.get('status') as TaxDocumentStatus;
		if (!id || !status) return fail(400, { error: 'Document and status are required' });
		try {
			await updateTaxDocument(id, { status });
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	deleteDocument: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Document is required' });
		try {
			await deleteTaxDocument(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	addLine: async ({ request }) => {
		const data = await request.formData();
		const documentId = data.get('documentId') as string;
		const box = data.get('box') as string;
		const label = (data.get('label') as string) || undefined;
		const amountRaw = data.get('amount') as string;
		const categoryRaw = (data.get('category') as string) ?? '';
		if (!documentId || !box?.trim() || !amountRaw) return fail(400, { error: 'Box and amount are required', documentId });

		// '' = guess from the form preset, 'none' = leave unmapped
		const category = categoryRaw === '' ? undefined : categoryRaw === 'none' ? null : categoryRaw;
		try {
			await addDocumentLine(documentId, { box, label, amount: parseFloat(amountRaw), category });
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message, documentId });
		}
	},

	deleteLine: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Line is required' });
		try {
			await deleteDocumentLine(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
