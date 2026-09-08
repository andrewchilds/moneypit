import { db } from '../db';
import type { TaxDocumentStatus } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';
import { getBoxPreset, normalizeFormType } from '$lib/taxForms';

export interface CreateTaxDocumentData {
	year: number;
	formType: string;
	issuer: string;
	accountId?: string | null;
	businessId?: string | null;
	notes?: string | null;
	status?: TaxDocumentStatus;
}

export interface UpdateTaxDocumentData {
	issuer?: string;
	accountId?: string | null;
	businessId?: string | null;
	notes?: string | null;
	status?: TaxDocumentStatus;
	formType?: string;
}

/** Where on the attached file a figure was read from. Fractions of the page. */
export interface LineRegion {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface AddDocumentLineData {
	box: string;
	amount: number;
	label?: string;
	/** Tax category id, or a category name to look up in the book */
	category?: string | null;
	/** undefined keeps an existing region on replace; null clears it */
	region?: LineRegion | null;
}

export interface AttachDocumentFileData {
	filename: string;
	mimeType: string;
	data: Uint8Array<ArrayBuffer>;
}

export const DOCUMENT_FILE_TYPES: Record<string, string> = {
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};

export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

const fileSelect = { id: true, filename: true, mimeType: true, size: true, createdAt: true };

const documentInclude = {
	lines: { orderBy: { box: 'asc' as const }, include: { taxCategory: { select: { id: true, name: true, scheduleRef: true } } } },
	account: { select: { id: true, path: true } },
	business: { select: { id: true, name: true } },
	file: { select: fileSelect }
};

async function checkBusiness(bookId: string, businessId: string | null | undefined): Promise<void> {
	if (!businessId) return;
	const business = await db.business.findUnique({ where: { id: businessId } });
	if (!business || business.bookId !== bookId) throw new Error('Business not found in this book');
}

export async function listTaxDocuments(bookId: string, year?: number) {
	return db.taxDocument.findMany({
		where: { bookId, ...(year !== undefined ? { year } : {}) },
		include: documentInclude,
		orderBy: [{ year: 'desc' }, { formType: 'asc' }, { issuer: 'asc' }]
	});
}

export async function getTaxDocument(id: string) {
	return db.taxDocument.findUnique({ where: { id }, include: documentInclude });
}

export async function createTaxDocument(bookId: string, data: CreateTaxDocumentData) {
	if (!data.issuer?.trim()) throw new Error('Issuer is required');
	if (!Number.isInteger(data.year)) throw new Error('Year is required');
	if (data.accountId) {
		const account = await db.account.findUnique({ where: { id: data.accountId } });
		if (!account || account.bookId !== bookId) throw new Error('Account not found in this book');
	}
	await checkBusiness(bookId, data.businessId);

	const result = await db.taxDocument.create({
		data: {
			bookId,
			year: data.year,
			formType: normalizeFormType(data.formType),
			issuer: data.issuer.trim(),
			accountId: data.accountId ?? null,
			businessId: data.businessId ?? null,
			notes: data.notes ?? null,
			status: data.status ?? 'RECEIVED'
		},
		include: documentInclude
	});

	await logOperation(bookId, 'CREATE', `Added ${result.formType} from ${result.issuer} for ${result.year}`, [
		{ entityType: 'TaxDocument', entityId: result.id, before: null, after: serialize(stripRelations(result)) }
	]);
	return result;
}

export async function updateTaxDocument(id: string, data: UpdateTaxDocumentData) {
	const existing = await db.taxDocument.findUnique({ where: { id } });
	if (!existing) throw new Error('Document not found');
	if (data.accountId) {
		const account = await db.account.findUnique({ where: { id: data.accountId } });
		if (!account || account.bookId !== existing.bookId) throw new Error('Account not found in this book');
	}
	await checkBusiness(existing.bookId, data.businessId);

	const result = await db.taxDocument.update({
		where: { id },
		data: {
			...(data.issuer !== undefined && { issuer: data.issuer.trim() }),
			...(data.formType !== undefined && { formType: normalizeFormType(data.formType) }),
			...(data.accountId !== undefined && { accountId: data.accountId }),
			...(data.businessId !== undefined && { businessId: data.businessId }),
			...(data.notes !== undefined && { notes: data.notes }),
			...(data.status !== undefined && { status: data.status })
		},
		include: documentInclude
	});

	const { before, after } = diff(serialize(existing), serialize(stripRelations(result)));
	if (Object.keys(before).length > 0) {
		await logOperation(existing.bookId, 'UPDATE', `Updated ${result.formType} from ${result.issuer}`, [
			{ entityType: 'TaxDocument', entityId: id, before, after }
		]);
	}
	return result;
}

export async function deleteTaxDocument(id: string) {
	const existing = await db.taxDocument.findUnique({ where: { id }, include: { lines: true } });
	if (!existing) throw new Error('Document not found');
	await db.taxDocument.delete({ where: { id } });
	await logOperation(existing.bookId, 'DELETE', `Deleted ${existing.formType} from ${existing.issuer} for ${existing.year}`, [
		...existing.lines.map((line) => ({
			entityType: 'TaxDocumentLine' as const,
			entityId: line.id,
			before: serialize(line),
			after: null
		})),
		{ entityType: 'TaxDocument', entityId: id, before: serialize(stripRelations(existing)), after: null }
	]);
}

/**
 * Add a line to a document. A line with the same box replaces the earlier
 * one. Label and tax category fall back to the form preset for that box.
 */
export async function addDocumentLine(documentId: string, data: AddDocumentLineData) {
	const document = await db.taxDocument.findUnique({ where: { id: documentId } });
	if (!document) throw new Error('Document not found');
	if (!data.box?.trim()) throw new Error('Box is required');
	if (typeof data.amount !== 'number' || Number.isNaN(data.amount)) throw new Error('Amount is required');

	const box = data.box.trim();
	const preset = getBoxPreset(document.formType, box);
	const label = data.label?.trim() || preset?.label || `Box ${box}`;

	let taxCategoryId: string | null = null;
	if (data.category) {
		taxCategoryId = await resolveCategory(document.bookId, data.category);
	} else if (data.category === undefined && preset?.categoryHints) {
		taxCategoryId = await guessCategory(document.bookId, preset.categoryHints);
	}

	const existing = await db.taxDocumentLine.findFirst({
		where: { documentId, box: { equals: box, mode: 'insensitive' } }
	});

	const region = data.region === undefined ? {} : regionFields(data.region);
	const lineData = { box, label, amount: data.amount, taxCategoryId, ...region };
	const result = existing
		? await db.taxDocumentLine.update({ where: { id: existing.id }, data: lineData, include: { taxCategory: true } })
		: await db.taxDocumentLine.create({
				data: { documentId, ...lineData, ...regionFields(data.region ?? null) },
				include: { taxCategory: true }
			});

	if (existing) {
		const { before, after } = diff(serialize(existing), serialize({ ...result, taxCategory: undefined }));
		if (Object.keys(before).length > 0) {
			await logOperation(document.bookId, 'UPDATE', `Updated ${document.formType} box ${box}`, [
				{ entityType: 'TaxDocumentLine', entityId: result.id, before, after }
			]);
		}
	} else {
		await logOperation(document.bookId, 'CREATE', `Added ${document.formType} box ${box}: ${label}`, [
			{ entityType: 'TaxDocumentLine', entityId: result.id, before: null, after: serialize({ ...result, taxCategory: undefined }) }
		]);
	}
	return result;
}

function regionFields(region: LineRegion | null) {
	if (!region) return { page: null, x: null, y: null, w: null, h: null };
	const { page, x, y, w, h } = region;
	if (!Number.isInteger(page) || page < 1) throw new Error('Region page must be a positive integer');
	for (const v of [x, y, w, h]) {
		if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) throw new Error('Region must be fractions of the page');
	}
	return { page, x, y, w, h };
}

/** Attach the form itself (PDF or image) to a document, replacing any earlier file. */
export async function attachDocumentFile(documentId: string, file: AttachDocumentFileData) {
	const document = await db.taxDocument.findUnique({ where: { id: documentId } });
	if (!document) throw new Error('Document not found');
	if (!DOCUMENT_FILE_TYPES[file.mimeType]) {
		throw new Error(`Unsupported file type ${file.mimeType}; use a PDF, PNG, JPEG, or WebP`);
	}
	if (file.data.byteLength === 0) throw new Error('File is empty');
	if (file.data.byteLength > MAX_DOCUMENT_FILE_BYTES) throw new Error('File is larger than 25 MB');

	const filename = file.filename.trim() || `${document.formType}.${DOCUMENT_FILE_TYPES[file.mimeType]}`;
	// Replace rather than update so the file id (used as a cache key) changes,
	// and clear regions that pointed into the old file.
	const [, , result] = await db.$transaction([
		db.taxDocumentFile.deleteMany({ where: { documentId } }),
		db.taxDocumentLine.updateMany({ where: { documentId }, data: regionFields(null) }),
		db.taxDocumentFile.create({
			data: { documentId, filename, mimeType: file.mimeType, size: file.data.byteLength, data: file.data },
			select: fileSelect
		})
	]);
	await logOperation(document.bookId, 'UPDATE', `Attached ${filename} to ${document.formType} from ${document.issuer}`, [
		{ entityType: 'TaxDocument', entityId: documentId, before: {}, after: {} }
	]);
	return result;
}

const EXTENSION_TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Work out the MIME type of an upload from what the browser says, then the extension. */
export function documentFileType(filename: string, declared?: string | null): string {
	if (declared && DOCUMENT_FILE_TYPES[declared]) return declared;
	const ext = filename.toLowerCase().split('.').pop() ?? '';
	return EXTENSION_TYPES[ext] ?? declared ?? 'application/octet-stream';
}

/** Attach a file from a multipart form upload. */
export async function attachUploadedFile(documentId: string, file: File) {
	const data = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>;
	return attachDocumentFile(documentId, { filename: file.name, mimeType: documentFileType(file.name, file.type), data });
}

/** Remove the attached file. Lines keep their amounts but lose their regions. */
export async function detachDocumentFile(documentId: string) {
	const document = await db.taxDocument.findUnique({ where: { id: documentId }, include: { file: { select: fileSelect } } });
	if (!document) throw new Error('Document not found');
	if (!document.file) throw new Error('Document has no file attached');
	await db.$transaction([
		db.taxDocumentFile.delete({ where: { documentId } }),
		db.taxDocumentLine.updateMany({ where: { documentId }, data: regionFields(null) })
	]);
	await logOperation(document.bookId, 'UPDATE', `Removed ${document.file.filename} from ${document.formType} from ${document.issuer}`, [
		{ entityType: 'TaxDocument', entityId: documentId, before: {}, after: {} }
	]);
}

/** The attached file with its bytes, for serving or exporting. */
export async function getDocumentFile(documentId: string) {
	return db.taxDocumentFile.findUnique({ where: { documentId } });
}

export async function deleteDocumentLine(lineId: string) {
	const existing = await db.taxDocumentLine.findUnique({ where: { id: lineId }, include: { document: true } });
	if (!existing) throw new Error('Line not found');
	await db.taxDocumentLine.delete({ where: { id: lineId } });
	const { document, ...line } = existing;
	await logOperation(document.bookId, 'DELETE', `Deleted ${document.formType} box ${line.box}`, [
		{ entityType: 'TaxDocumentLine', entityId: lineId, before: serialize(line), after: null }
	]);
}

export interface DocumentLineRef {
	documentId: string;
	formType: string;
	issuer: string;
	/** Business the document was filed under, for per-business schedules */
	businessId: string | null;
	box: string;
	label: string;
	amount: number;
}

export interface DocumentCategoryTotal {
	total: number;
	lines: DocumentLineRef[];
}

/**
 * Sum received document lines per tax category for a year. These are the
 * authoritative figures that override book totals in the tax report.
 */
export async function getDocumentTotalsByCategory(bookId: string, year: number): Promise<Map<string, DocumentCategoryTotal>> {
	const lines = await db.taxDocumentLine.findMany({
		where: { taxCategoryId: { not: null }, document: { bookId, year, status: 'RECEIVED' } },
		include: { document: { select: { id: true, formType: true, issuer: true, businessId: true } } },
		orderBy: [{ document: { formType: 'asc' } }, { box: 'asc' }]
	});

	const totals = new Map<string, DocumentCategoryTotal>();
	for (const line of lines) {
		const key = line.taxCategoryId!;
		const entry = totals.get(key) ?? { total: 0, lines: [] };
		const amount = Number(line.amount);
		entry.total += amount;
		entry.lines.push({
			documentId: line.document.id,
			formType: line.document.formType,
			issuer: line.document.issuer,
			businessId: line.document.businessId,
			box: line.box,
			label: line.label,
			amount
		});
		totals.set(key, entry);
	}
	return totals;
}

/** Resolve a category by id, then by exact name within the book. */
async function resolveCategory(bookId: string, idOrName: string): Promise<string> {
	const byId = await db.taxCategory.findUnique({ where: { id: idOrName } });
	if (byId && byId.bookId === bookId) return byId.id;
	const byName = await db.taxCategory.findFirst({
		where: { bookId, name: { equals: idOrName.trim(), mode: 'insensitive' } }
	});
	if (byName) return byName.id;
	throw new Error(`Tax category not found: ${idOrName}`);
}

async function guessCategory(bookId: string, hints: string[]): Promise<string | null> {
	const categories = await db.taxCategory.findMany({ where: { bookId }, select: { id: true, name: true } });
	for (const hint of hints) {
		const re = new RegExp(hint, 'i');
		const match = categories.find((c) => re.test(c.name));
		if (match) return match.id;
	}
	return null;
}

function stripRelations<T extends { lines?: unknown; account?: unknown; business?: unknown; file?: unknown }>(
	doc: T
): Omit<T, 'lines' | 'account' | 'business' | 'file'> {
	const rest: Record<string, unknown> = { ...doc };
	delete rest.lines;
	delete rest.account;
	delete rest.business;
	delete rest.file;
	return rest as Omit<T, 'lines' | 'account' | 'business' | 'file'>;
}
