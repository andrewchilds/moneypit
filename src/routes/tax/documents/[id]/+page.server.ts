import { error, fail, redirect, isRedirect } from '@sveltejs/kit';
import {
	getTaxDocument,
	updateTaxDocument,
	addDocumentLine,
	deleteDocumentLine,
	attachUploadedFile,
	detachDocumentFile,
	linkDocumentFile,
	listDocumentFiles,
	createTaxDocument,
	type LineRegion
} from '$lib/server/actions/taxDocuments';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import { FORM_PRESETS } from '$lib/taxForms';
import type { PageServerLoad, Actions } from './$types';

async function loadDocument(id: string, bookId: string) {
	const doc = await getTaxDocument(id);
	if (!doc || doc.bookId !== bookId) throw error(404, 'Document not found');
	return doc;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const doc = await loadDocument(params.id, locals.bookId);
	const [taxCategories, files] = await Promise.all([listTaxCategories(locals.bookId), listDocumentFiles(locals.bookId, doc.year)]);
	return {
		document: {
			...doc,
			// Decimal amounts can't cross the wire
			lines: doc.lines.map((l) => ({ ...l, amount: Number(l.amount) }))
		},
		preset: FORM_PRESETS[doc.formType] ?? null,
		taxCategories: taxCategories.map((c) => ({ id: c.id, name: c.name, scheduleRef: c.scheduleRef })),
		// Files on other documents this year, so this one can be read from
		// an upload already on hand (a consolidated 1099)
		otherFiles: files.filter((f) => f.id !== doc.file?.id),
		formTypes: Object.entries(FORM_PRESETS).map(([formType, preset]) => ({ formType, name: preset.name }))
	};
};

/** Region fields come as fractions of the page; absent means "no region". */
function parseRegion(data: FormData): LineRegion | null | undefined {
	const page = data.get('page') as string | null;
	if (page === null) return undefined;
	if (page === '') return null;
	const num = (key: string) => parseFloat(data.get(key) as string);
	return { page: parseInt(page, 10), x: num('x'), y: num('y'), w: num('w'), h: num('h') };
}

export const actions: Actions = {
	addLine: async ({ params, request, locals }) => {
		await loadDocument(params.id, locals.bookId);
		const data = await request.formData();
		const box = data.get('box') as string;
		const label = (data.get('label') as string) || undefined;
		const amountRaw = data.get('amount') as string;
		const categoryRaw = (data.get('category') as string) ?? '';
		if (!box?.trim() || !amountRaw?.trim()) return fail(400, { error: 'Box and amount are required' });

		// '' = guess from the form preset, 'none' = leave unmapped
		const category = categoryRaw === '' ? undefined : categoryRaw === 'none' ? null : categoryRaw;
		try {
			const line = await addDocumentLine(params.id, {
				box,
				label,
				amount: parseFloat(amountRaw.replace(/[^0-9.-]/g, '')),
				category,
				region: parseRegion(data)
			});
			return { success: true, lineId: line.id };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	deleteLine: async ({ params, request, locals }) => {
		const doc = await loadDocument(params.id, locals.bookId);
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!doc.lines.some((l) => l.id === id)) return fail(400, { error: 'Line not found' });
		try {
			await deleteDocumentLine(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	attachFile: async ({ params, request, locals }) => {
		await loadDocument(params.id, locals.bookId);
		const data = await request.formData();
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a PDF or image to attach' });
		try {
			await attachUploadedFile(params.id, file);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	// Read this document from a file already attached to another one
	linkFile: async ({ params, request, locals }) => {
		await loadDocument(params.id, locals.bookId);
		const data = await request.formData();
		const fileId = data.get('fileId') as string;
		if (!fileId) return fail(400, { error: 'Choose a file' });
		try {
			await linkDocumentFile(params.id, fileId);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	// Another form on the same file: a new document, same issuer, account
	// and business, sharing this one's file
	addFromFile: async ({ params, request, locals }) => {
		const doc = await loadDocument(params.id, locals.bookId);
		if (!doc.file) return fail(400, { error: 'This document has no file to share' });
		const data = await request.formData();
		const formType = data.get('formType') as string;
		if (!formType?.trim()) return fail(400, { error: 'Form type is required' });
		try {
			const created = await createTaxDocument(locals.bookId, {
				year: doc.year,
				formType,
				issuer: doc.issuer,
				accountId: doc.accountId,
				businessId: doc.businessId
			});
			await linkDocumentFile(created.id, doc.file.id);
			throw redirect(303, `/tax/documents/${created.id}`);
		} catch (e) {
			if (isRedirect(e)) throw e;
			return fail(400, { error: (e as Error).message });
		}
	},

	removeFile: async ({ params, locals }) => {
		await loadDocument(params.id, locals.bookId);
		try {
			await detachDocumentFile(params.id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	updateNotes: async ({ params, request, locals }) => {
		await loadDocument(params.id, locals.bookId);
		const data = await request.formData();
		const notes = ((data.get('notes') as string) ?? '').trim() || null;
		try {
			await updateTaxDocument(params.id, { notes });
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
