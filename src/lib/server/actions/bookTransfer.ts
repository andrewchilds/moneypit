import { db } from '../db';
import { findQuestion } from '../taxModules';
import type { AccountType, AssetType, TransactionStatus, TaxDocumentStatus, Prisma } from '@prisma/client';

// Export format version for future compatibility
const EXPORT_VERSION = 1;

export interface BookExport {
	version: number;
	exportedAt: string;
	book: {
		name: string;
		description: string | null;
		isDemo: boolean;
	};
	taxCategories: ExportedTaxCategory[];
	accounts: ExportedAccount[];
	rules: ExportedRule[];
	transactions: ExportedTransaction[];
	balanceRecords: ExportedBalanceRecord[];
	dismissedDuplicates: ExportedDismissedDuplicate[];
	enabledModules: string[];
	// Added later; absent in older exports
	taxDocuments?: ExportedTaxDocument[];
	taxFacts?: ExportedTaxFact[];
	businesses?: ExportedBusiness[];
	businessAccounts?: ExportedBusinessAccount[];
}

interface ExportedBusiness {
	id: string;
	name: string;
}

interface ExportedTaxDocument {
	id: string;
	year: number;
	formType: string;
	issuer: string;
	status: TaxDocumentStatus;
	accountId: string | null;
	businessId?: string | null;
	notes: string | null;
	lines: {
		box: string;
		label: string;
		amount: string;
		taxCategoryId: string | null;
		// Added later; absent in older exports
		page?: number | null;
		x?: number | null;
		y?: number | null;
		w?: number | null;
		h?: number | null;
	}[];
	// The attached form, base64-encoded. Added later; absent in older exports
	file?: {
		filename: string;
		mimeType: string;
		data: string;
	} | null;
}

interface ExportedTaxFact {
	year: number | null;
	key: string;
	value: unknown;
	businessId?: string | null;
}

interface ExportedTaxCategory {
	id: string;
	name: string;
	description: string | null;
	scheduleRef: string | null;
	year: number | null;
	moduleId: string | null;
}

interface ExportedAccount {
	id: string;
	type: AccountType;
	assetType: AssetType | null;
	path: string;
	last4: string | null;
	openingBalance: string | null;
	taxCategoryId: string | null;
	/** Older exports: the one business the account belonged to, wholly */
	businessId?: string | null;
}

/** An account attached to a business at a percentage. Added later; absent in older exports */
interface ExportedBusinessAccount {
	accountId: string;
	businessId: string;
	percent: number;
}

interface ExportedRule {
	id: string;
	pattern: string;
	accountId: string;
	field: string;
	priority: number;
	isRegex: boolean;
	amountMin: string | null;
	amountMax: string | null;
	amountExact: string | null;
}

interface ExportedTransaction {
	id: string;
	date: string;
	description: string;
	memo: string | null;
	amount: string;
	debitAccountId: string | null;
	creditAccountId: string | null;
	status: TransactionStatus;
	importSource: string | null;
	importHash: string | null;
	mergedIntoId: string | null;
}

interface ExportedBalanceRecord {
	id: string;
	accountId: string;
	date: string;
	balance: string;
}

interface ExportedDismissedDuplicate {
	tx1Id: string;
	tx2Id: string;
}

export async function exportBook(bookId: string): Promise<BookExport> {
	const book = await db.book.findUnique({
		where: { id: bookId },
		include: {
			taxCategories: true,
			accounts: {
				include: {
					balanceRecords: true
				}
			},
			rules: true,
			transactions: {
				include: {
					dismissedDupes1: true
				}
			},
			taxModules: true,
			taxDocuments: { include: { lines: true, file: true } },
			taxFacts: true,
			businesses: { orderBy: { createdAt: 'asc' }, include: { accounts: true } }
		}
	});

	if (!book) {
		throw new Error(`Book not found: ${bookId}`);
	}

	// Collect all dismissed duplicates (avoid duplicates since we only query one side)
	const dismissedDuplicates: ExportedDismissedDuplicate[] = [];
	const seenPairs = new Set<string>();
	for (const tx of book.transactions) {
		for (const dd of tx.dismissedDupes1) {
			const pairKey = [dd.tx1Id, dd.tx2Id].sort().join(':');
			if (!seenPairs.has(pairKey)) {
				seenPairs.add(pairKey);
				dismissedDuplicates.push({
					tx1Id: dd.tx1Id,
					tx2Id: dd.tx2Id
				});
			}
		}
	}

	// Collect all balance records
	const balanceRecords: ExportedBalanceRecord[] = [];
	for (const account of book.accounts) {
		for (const br of account.balanceRecords) {
			balanceRecords.push({
				id: br.id,
				accountId: br.accountId,
				date: br.date.toISOString(),
				balance: br.balance.toString()
			});
		}
	}

	return {
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		book: {
			name: book.name,
			description: book.description,
			isDemo: book.isDemo
		},
		taxCategories: book.taxCategories.map((tc) => ({
			id: tc.id,
			name: tc.name,
			description: tc.description,
			scheduleRef: tc.scheduleRef,
			year: tc.year,
			moduleId: tc.moduleId
		})),
		accounts: book.accounts.map((a) => ({
			id: a.id,
			type: a.type,
			assetType: a.assetType,
			path: a.path,
			last4: a.last4,
			openingBalance: a.openingBalance?.toString() ?? null,
			taxCategoryId: a.taxCategoryId
		})),
		rules: book.rules.map((r) => ({
			id: r.id,
			pattern: r.pattern,
			accountId: r.accountId,
			field: r.field,
			priority: r.priority,
			isRegex: r.isRegex,
			amountMin: r.amountMin?.toString() ?? null,
			amountMax: r.amountMax?.toString() ?? null,
			amountExact: r.amountExact?.toString() ?? null
		})),
		transactions: book.transactions.map((t) => ({
			id: t.id,
			date: t.date.toISOString(),
			description: t.description,
			memo: t.memo,
			amount: t.amount.toString(),
			debitAccountId: t.debitAccountId,
			creditAccountId: t.creditAccountId,
			status: t.status,
			importSource: t.importSource,
			importHash: t.importHash,
			mergedIntoId: t.mergedIntoId
		})),
		balanceRecords,
		dismissedDuplicates,
		enabledModules: book.taxModules.map((tm) => tm.moduleId),
		taxDocuments: book.taxDocuments.map((d) => ({
			id: d.id,
			year: d.year,
			formType: d.formType,
			issuer: d.issuer,
			status: d.status,
			accountId: d.accountId,
			businessId: d.businessId,
			notes: d.notes,
			lines: d.lines.map((l) => ({
				box: l.box,
				label: l.label,
				amount: l.amount.toString(),
				taxCategoryId: l.taxCategoryId,
				page: l.page,
				x: l.x,
				y: l.y,
				w: l.w,
				h: l.h
			})),
			file: d.file
				? { filename: d.file.filename, mimeType: d.file.mimeType, data: Buffer.from(d.file.data).toString('base64') }
				: null
		})),
		taxFacts: book.taxFacts.map((f) => ({ year: f.year, key: f.key, value: f.value, businessId: f.businessId })),
		businesses: book.businesses.map((b) => ({ id: b.id, name: b.name })),
		businessAccounts: book.businesses.flatMap((b) =>
			b.accounts.map((l) => ({ accountId: l.accountId, businessId: l.businessId, percent: Number(l.percent) }))
		)
	};
}

export interface ImportResult {
	bookId: string;
	bookName: string;
	taxCategories: number;
	accounts: number;
	rules: number;
	transactions: number;
	balanceRecords: number;
	dismissedDuplicates: number;
	enabledModules: number;
	taxDocuments: number;
	taxFacts: number;
	businesses: number;
}

export async function importBook(
	data: BookExport,
	options?: { name?: string; description?: string }
): Promise<ImportResult> {
	if (data.version !== EXPORT_VERSION) {
		throw new Error(`Unsupported export version: ${data.version}. Expected: ${EXPORT_VERSION}`);
	}

	// Use provided name or add suffix to avoid conflicts
	const bookName = options?.name ?? `${data.book.name} (imported)`;

	// Check if book name already exists
	const existingBook = await db.book.findUnique({ where: { name: bookName } });
	if (existingBook) {
		throw new Error(`A book named "${bookName}" already exists. Use --name to specify a different name.`);
	}

	// Create the new book
	const newBook = await db.book.create({
		data: {
			name: bookName,
			description: options?.description ?? data.book.description,
			isDemo: data.book.isDemo
		}
	});

	// Maps from old IDs to new IDs
	const taxCategoryIdMap = new Map<string, string>();
	const accountIdMap = new Map<string, string>();
	const transactionIdMap = new Map<string, string>();
	const businessIdMap = new Map<string, string>();

	// 0. Create businesses
	const businesses = data.businesses ?? [];
	for (const b of businesses) {
		const newBusiness = await db.business.create({ data: { bookId: newBook.id, name: b.name } });
		businessIdMap.set(b.id, newBusiness.id);
	}
	const mapBusiness = (id: string | null | undefined) => (id ? (businessIdMap.get(id) ?? null) : null);

	// 1. Create tax categories
	for (const tc of data.taxCategories) {
		const newTc = await db.taxCategory.create({
			data: {
				bookId: newBook.id,
				name: tc.name,
				description: tc.description,
				scheduleRef: tc.scheduleRef,
				year: tc.year,
				moduleId: tc.moduleId
			}
		});
		taxCategoryIdMap.set(tc.id, newTc.id);
	}

	// 2. Create accounts
	for (const a of data.accounts) {
		const newAccount = await db.account.create({
			data: {
				bookId: newBook.id,
				type: a.type,
				assetType: a.assetType,
				path: a.path,
				last4: a.last4,
				openingBalance: a.openingBalance ? parseFloat(a.openingBalance) : null,
				taxCategoryId: a.taxCategoryId ? taxCategoryIdMap.get(a.taxCategoryId) : null
			}
		});
		accountIdMap.set(a.id, newAccount.id);
	}

	// Attach accounts to businesses: from the link list, or for older
	// exports from the account's single business (wholly) and the
	// shared_use_accounts answers (at their percentages)
	const businessAccounts: ExportedBusinessAccount[] = data.businessAccounts ?? [];
	for (const a of data.accounts) {
		if (a.businessId && !businessAccounts.some((l) => l.accountId === a.id && l.businessId === a.businessId)) {
			businessAccounts.push({ accountId: a.id, businessId: a.businessId, percent: 100 });
		}
	}
	for (const f of data.taxFacts ?? []) {
		if (f.key !== 'shared_use_accounts' || !f.businessId || !Array.isArray(f.value)) continue;
		for (const v of f.value as { id?: unknown; percent?: unknown }[]) {
			if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !Number.isFinite(Number(v.percent))) continue;
			if (businessAccounts.some((l) => l.accountId === v.id && l.businessId === f.businessId)) continue;
			businessAccounts.push({ accountId: v.id, businessId: f.businessId, percent: Number(v.percent) });
		}
	}
	for (const l of businessAccounts) {
		const accountId = accountIdMap.get(l.accountId);
		const businessId = mapBusiness(l.businessId);
		if (!accountId || !businessId || !(l.percent > 0 && l.percent <= 100)) continue;
		await db.businessAccount.create({ data: { accountId, businessId, percent: l.percent } });
	}

	// 3. Create rules
	for (const r of data.rules) {
		const newAccountId = accountIdMap.get(r.accountId);
		if (!newAccountId) {
			console.warn(`Skipping rule "${r.pattern}": account ${r.accountId} not found`);
			continue;
		}
		await db.rule.create({
			data: {
				bookId: newBook.id,
				pattern: r.pattern,
				accountId: newAccountId,
				field: r.field,
				priority: r.priority,
				isRegex: r.isRegex,
				amountMin: r.amountMin ? parseFloat(r.amountMin) : null,
				amountMax: r.amountMax ? parseFloat(r.amountMax) : null,
				amountExact: r.amountExact ? parseFloat(r.amountExact) : null
			}
		});
	}

	// 4. Create transactions (first pass - without mergedIntoId)
	for (const t of data.transactions) {
		const newTx = await db.transaction.create({
			data: {
				bookId: newBook.id,
				date: new Date(t.date),
				description: t.description,
				memo: t.memo,
				amount: parseFloat(t.amount),
				debitAccountId: t.debitAccountId ? accountIdMap.get(t.debitAccountId) : null,
				creditAccountId: t.creditAccountId ? accountIdMap.get(t.creditAccountId) : null,
				status: t.status,
				importSource: t.importSource,
				importHash: t.importHash
				// mergedIntoId set in second pass
			}
		});
		transactionIdMap.set(t.id, newTx.id);
	}

	// 5. Update mergedIntoId references
	for (const t of data.transactions) {
		if (t.mergedIntoId) {
			const newTxId = transactionIdMap.get(t.id);
			const newMergedIntoId = transactionIdMap.get(t.mergedIntoId);
			if (newTxId && newMergedIntoId) {
				await db.transaction.update({
					where: { id: newTxId },
					data: { mergedIntoId: newMergedIntoId }
				});
			}
		}
	}

	// 6. Create balance records
	for (const br of data.balanceRecords) {
		const newAccountId = accountIdMap.get(br.accountId);
		if (!newAccountId) {
			console.warn(`Skipping balance record: account ${br.accountId} not found`);
			continue;
		}
		await db.balanceRecord.create({
			data: {
				accountId: newAccountId,
				date: new Date(br.date),
				balance: parseFloat(br.balance)
			}
		});
	}

	// 7. Create dismissed duplicates
	let dismissedCreated = 0;
	for (const dd of data.dismissedDuplicates) {
		const newTx1Id = transactionIdMap.get(dd.tx1Id);
		const newTx2Id = transactionIdMap.get(dd.tx2Id);
		if (newTx1Id && newTx2Id) {
			await db.dismissedDuplicate.create({
				data: {
					tx1Id: newTx1Id,
					tx2Id: newTx2Id
				}
			});
			dismissedCreated++;
		}
	}

	// 8. Create enabled modules
	for (const moduleId of data.enabledModules) {
		await db.bookTaxModule.create({
			data: {
				bookId: newBook.id,
				moduleId
			}
		});
	}

	// 9. Create tax documents and facts
	const taxDocuments = data.taxDocuments ?? [];
	for (const d of taxDocuments) {
		await db.taxDocument.create({
			data: {
				bookId: newBook.id,
				year: d.year,
				formType: d.formType,
				issuer: d.issuer,
				status: d.status,
				accountId: d.accountId ? (accountIdMap.get(d.accountId) ?? null) : null,
				businessId: mapBusiness(d.businessId),
				notes: d.notes,
				lines: {
					create: d.lines.map((l) => ({
						box: l.box,
						label: l.label,
						amount: parseFloat(l.amount),
						taxCategoryId: l.taxCategoryId ? (taxCategoryIdMap.get(l.taxCategoryId) ?? null) : null,
						page: l.page ?? null,
						x: l.x ?? null,
						y: l.y ?? null,
						w: l.w ?? null,
						h: l.h ?? null
					}))
				},
				...(d.file
					? {
							file: {
								create: {
									filename: d.file.filename,
									mimeType: d.file.mimeType,
									data: Buffer.from(d.file.data, 'base64'),
									size: Buffer.byteLength(d.file.data, 'base64')
								}
							}
						}
					: {})
			}
		});
	}

	// Answers that list account ids point at the new book's accounts
	const mapFactValue = (key: string, value: unknown): unknown => {
		const type = findQuestion(key)?.question.type;
		if (!Array.isArray(value)) return value;
		if (type === 'accounts') return value.map((id) => (typeof id === 'string' ? (accountIdMap.get(id) ?? id) : id));
		return value;
	};

	// shared_use answers from older exports became attachments above
	const taxFacts = (data.taxFacts ?? []).filter((f) => f.key !== 'shared_use' && f.key !== 'shared_use_accounts');
	for (const f of taxFacts) {
		await db.taxFact.create({
			data: {
				bookId: newBook.id,
				year: f.year,
				key: f.key,
				value: mapFactValue(f.key, f.value) as Prisma.InputJsonValue,
				businessId: mapBusiness(f.businessId)
			}
		});
	}

	return {
		bookId: newBook.id,
		bookName: newBook.name,
		taxDocuments: taxDocuments.length,
		taxFacts: taxFacts.length,
		businesses: businesses.length,
		taxCategories: data.taxCategories.length,
		accounts: data.accounts.length,
		rules: data.rules.length,
		transactions: data.transactions.length,
		balanceRecords: data.balanceRecords.length,
		dismissedDuplicates: dismissedCreated,
		enabledModules: data.enabledModules.length
	};
}
