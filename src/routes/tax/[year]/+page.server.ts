import { error, fail } from '@sveltejs/kit';
import { getTaxYearStatus } from '$lib/server/actions/taxYear';
import { setTaxFact, deleteTaxFact, parseFactValue } from '$lib/server/actions/taxFacts';
import {
	getTaxDocument,
	createTaxDocument,
	updateTaxDocument,
	deleteTaxDocument,
	addDocumentLine,
	deleteDocumentLine,
	attachUploadedFile,
	linkDocumentFile,
	listDocumentFiles
} from '$lib/server/actions/taxDocuments';
import { listAccounts } from '$lib/server/actions/accounts';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import {
	createBusiness,
	updateBusiness,
	deleteBusiness,
	listBusinessAccounts,
	setBusinessAccount,
	removeBusinessAccount
} from '$lib/server/actions/businesses';
import { getEnabledModules } from '$lib/server/actions/taxModules';
import { findQuestion, perBusinessSchedules, scheduleOf } from '$lib/server/taxModules';
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

	const [status, accounts, taxCategories, enabledModules, businessAccounts, files] = await Promise.all([
		getTaxYearStatus(bookId, year),
		listAccounts(bookId),
		listTaxCategories(bookId),
		getEnabledModules(bookId),
		listBusinessAccounts(bookId),
		listDocumentFiles(bookId, year)
	]);

	const currentYear = new Date().getFullYear();

	// Accounts on a per-business schedule (Schedule C): those attached to no
	// business still need one, since the report puts them in a section of
	// their own.
	const categoryById = new Map(taxCategories.map((c) => [c.id, c]));
	const splitSchedules = perBusinessSchedules();
	const scheduleAccountIds = accounts
		.filter((a) => {
			const schedule = scheduleOf(a.taxCategoryId ? (categoryById.get(a.taxCategoryId)?.scheduleRef ?? null) : null);
			return schedule !== null && splitSchedules.has(schedule);
		})
		.map((a) => a.id);

	return {
		hasPerBusinessModule: enabledModules.some((e) => e.module.perBusiness),
		businessAccounts,
		scheduleAccountIds,
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
		// Files already attached this year, so a new document can be read from
		// one of them (a consolidated 1099 holding several forms)
		files,
		availableYears: Array.from({ length: 6 }, (_, i) => currentYear - i)
	};
};

export const actions: Actions = {
	answer: async ({ params, request, locals }) => {
		const year = parseYear(params.year);
		const data = await request.formData();
		const key = (data.get('key') as string | null)?.trim();
		const businessId = (data.get('businessId') as string | null) || null;
		if (!key) return fail(400, { error: 'Question key is required' });

		const question = findQuestion(key)?.question;
		// A multi-select posts one value per chosen option
		const raw = data.getAll('value').map(String).filter((v) => v.trim() !== '').join(',');
		try {
			if (raw.trim() === '') {
				await deleteTaxFact(locals.bookId, key, year, businessId).catch(() => undefined);
			} else {
				await setTaxFact(locals.bookId, key, parseFactValue(raw, question?.type, question?.options), year, businessId);
			}
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message, key });
		}
	},

	addBusiness: async ({ request, locals }) => {
		const data = await request.formData();
		const name = (data.get('name') as string | null) ?? '';
		try {
			await createBusiness(locals.bookId, name);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	renameBusiness: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const name = (data.get('name') as string | null) ?? '';
		if (!id) return fail(400, { error: 'Business is required' });
		try {
			await updateBusiness(id, { name });
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	deleteBusiness: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Business is required' });
		try {
			await deleteBusiness(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	// Attach an account to a business at a percentage, or change the
	// percentage of one already attached
	attachAccount: async ({ request }) => {
		const data = await request.formData();
		const businessId = (data.get('businessId') as string | null) || null;
		const accountId = (data.get('accountId') as string | null)?.trim();
		const percent = Number(data.get('percent') || 100);
		if (!businessId) return fail(400, { error: 'Business is required' });
		if (!accountId) return fail(400, { error: 'Account is required' });
		try {
			await setBusinessAccount(businessId, accountId, percent);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	detachAccount: async ({ request }) => {
		const data = await request.formData();
		const businessId = (data.get('businessId') as string | null) || null;
		const accountId = (data.get('accountId') as string | null)?.trim();
		if (!businessId || !accountId) return fail(400, { error: 'Business and account are required' });
		try {
			await removeBusinessAccount(businessId, accountId);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	addDocument: async ({ params, request, locals }) => {
		const year = parseYear(params.year);
		const data = await request.formData();
		const formType = data.get('formType') as string;
		const issuer = data.get('issuer') as string;
		const accountId = (data.get('accountId') as string) || null;
		const businessId = (data.get('businessId') as string) || null;
		const notes = (data.get('notes') as string) || null;
		const status = ((data.get('status') as string) || 'RECEIVED') as TaxDocumentStatus;
		if (!formType?.trim() || !issuer?.trim()) return fail(400, { error: 'Form type and issuer are required' });

		const file = data.get('file');
		const hasFile = file instanceof File && file.size > 0;
		// A file already attached to another document (a consolidated 1099)
		const fileId = (data.get('fileId') as string) || null;

		try {
			const doc = await createTaxDocument(locals.bookId, { year, formType, issuer, accountId, businessId, notes, status });
			if (hasFile) await attachUploadedFile(doc.id, file);
			else if (fileId) await linkDocumentFile(doc.id, fileId);
			return { success: true, documentId: doc.id, attached: hasFile || !!fileId };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	attachFile: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const file = data.get('file');
		if (!id) return fail(400, { error: 'Document is required' });
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a PDF or image to attach' });
		try {
			const doc = await getTaxDocument(id);
			if (!doc || doc.bookId !== locals.bookId) return fail(404, { error: 'Document not found' });
			await attachUploadedFile(id, file);
			return { success: true, documentId: id };
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
