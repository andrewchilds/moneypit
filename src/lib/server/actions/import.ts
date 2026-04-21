import { createHash } from "crypto";
import { db } from "../db";
import { parseOFX, type ParsedTransaction } from "../import/ofx";
import { parseCSV, type CSVMapping } from "../import/csv";
import { getAccount } from "./accounts";
import { logOperation, serialize, type Change } from "./operationLog";
import { applyRules } from "./rules";

export { previewCSV, detectDateFormat, type CSVMapping } from "../import/csv";
export type { ParsedTransaction } from "../import/ofx";

export interface PreviewTransaction {
	date: Date;
	description: string;
	memo?: string;
	amount: number;
	side: "debit" | "credit";
	isDuplicate: boolean;
}

export interface ImportPreview {
	transactions: PreviewTransaction[];
	total: number;
	duplicates: number;
}

export async function previewImport(
	filePath: string,
	accountId: string,
	mapping?: CSVMapping
): Promise<ImportPreview> {
	const account = await getAccount(accountId);
	if (!account) {
		throw new Error(`Account not found: ${accountId}`);
	}

	// Parse based on file type
	let transactions: ParsedTransaction[];
	const isOFX = filePath.match(/\.(ofx|qfx)$/i);

	if (isOFX) {
		transactions = await parseOFX(filePath);
	} else {
		if (!mapping) {
			throw new Error("CSV mapping required");
		}
		transactions = await parseCSV(filePath, mapping);
	}

	// Generate hashes for all transactions
	// Track sequence numbers for transactions with identical date/amount/description (no FITID)
	const baseHashCounts = new Map<string, number>();
	const txWithHashes = transactions.map((tx) => {
		const amount = Math.abs(tx.amount);

		// Base hash key for tracking duplicates within this batch
		const baseKey = `${tx.date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${tx.description}|${accountId}`;

		// Get and increment sequence number for this base key
		const seq = baseHashCounts.get(baseKey) || 0;
		baseHashCounts.set(baseKey, seq + 1);

		// Legacy hash (date/amount/description based, NO sequence) - matches old import format
		const legacyHash = generateLegacyImportHash(tx.date, amount, tx.description, accountId);

		// New FITID-based hash (only if FITID available)
		const fitidHash = tx.fitid ? generateImportHash(tx.date, amount, tx.description, accountId, 0, tx.fitid) : null;

		// Sequenced hash for CSV imports without FITID - includes sequence number to distinguish duplicates
		const seqHash = !tx.fitid && seq > 0 ? generateImportHash(tx.date, amount, tx.description, accountId, seq) : null;

		return { tx, amount, legacyHash, fitidHash, seqHash };
	});

	console.log(`[Import Preview] Processing ${transactions.length} transactions for account ${accountId}`);
	console.log(`[Import Preview] Transactions with FITID: ${transactions.filter((t) => t.fitid).length}`);
	for (const { tx, legacyHash, fitidHash, seqHash } of txWithHashes) {
		console.log(
			`[Import Preview] ${tx.date.toISOString().slice(0, 10)} | $${Math.abs(tx.amount)} | ${tx.description.slice(0, 30)} | fitid=${tx.fitid || "none"}`
		);
		console.log(`[Import Preview]   -> fitidHash: ${fitidHash || "n/a"}, seqHash: ${seqHash || "n/a"}, legacyHash: ${legacyHash}`);
	}

	// Batch check for existing duplicates in DB - check all hash formats
	const allHashes = txWithHashes.flatMap((t) => {
		const hashes = [t.legacyHash];
		if (t.fitidHash) hashes.push(t.fitidHash);
		if (t.seqHash) hashes.push(t.seqHash);
		return hashes;
	});
	const existingTxs = await db.transaction.findMany({
		where: { importHash: { in: allHashes } },
		select: { importHash: true }
	});
	const existingHashes = new Set(existingTxs.map((t) => t.importHash));

	console.log(`[Import Preview] Found ${existingHashes.size} matching hashes in database`);

	// Build preview
	let duplicates = 0;
	const preview: PreviewTransaction[] = txWithHashes.map(({ tx, amount, legacyHash, fitidHash, seqHash }) => {
		// Check all hash formats for duplicates
		const matchedHash =
			fitidHash && existingHashes.has(fitidHash)
				? fitidHash
				: seqHash && existingHashes.has(seqHash)
					? seqHash
					: existingHashes.has(legacyHash)
						? legacyHash
						: null;
		const isDuplicate = matchedHash !== null;
		if (isDuplicate) {
			duplicates++;
			const matchType = matchedHash === fitidHash ? "fitid" : matchedHash === seqHash ? "seq" : "legacy";
			console.log(
				`[Import Preview] DUPLICATE: ${tx.date.toISOString().slice(0, 10)} | $${amount} | ${tx.description.slice(0, 40)} | matched=${matchType}`
			);
		}

		return {
			date: tx.date,
			description: tx.description,
			memo: tx.memo,
			amount,
			side: tx.amount > 0 ? "debit" : "credit",
			isDuplicate
		};
	});

	console.log(`[Import Preview] Total duplicates: ${duplicates}, New transactions: ${preview.length - duplicates}`);

	return {
		transactions: preview,
		total: preview.length,
		duplicates
	};
}

export interface ImportResult {
	imported: number;
	skipped: number;
	duplicates: string[];
	total: number;
	rulesApplied?: number;
	transactionsCategorized?: number;
}

export function generateImportHash(
	date: Date,
	amount: number,
	description: string,
	accountId: string,
	seq: number = 0,
	fitid?: string
): string {
	// If FITID is available, use it for a more reliable hash
	const data = fitid
		? `fitid:${fitid}|${accountId}`
		: `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description}|${accountId}|${seq}`;
	return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

// Legacy hash format (without sequence number) for backward compatibility with old imports
export function generateLegacyImportHash(date: Date, amount: number, description: string, accountId: string): string {
	const data = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description}|${accountId}`;
	return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

export async function importTransactions(
	bookId: string,
	transactions: ParsedTransaction[],
	accountId: string,
	source: string
): Promise<ImportResult> {
	const result: ImportResult = {
		imported: 0,
		skipped: 0,
		duplicates: [],
		total: transactions.length
	};

	// Generate hashes for all transactions
	// For FITID transactions, generate both new (FITID-based) and legacy (date/amount/description) hashes
	// Track sequence numbers for transactions with identical date/amount/description (no FITID)
	const baseHashCounts = new Map<string, number>();
	const txWithHashes = transactions.map((tx) => {
		const amount = Math.abs(tx.amount);

		// Base hash key for tracking duplicates within this batch
		const baseKey = `${tx.date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${tx.description}|${accountId}`;

		// Get and increment sequence number for this base key
		const seq = baseHashCounts.get(baseKey) || 0;
		baseHashCounts.set(baseKey, seq + 1);

		// Legacy hash (date/amount/description based, NO sequence) - matches old import format
		const legacyHash = generateLegacyImportHash(tx.date, amount, tx.description, accountId);

		// New FITID-based hash (only if FITID available)
		const fitidHash = tx.fitid ? generateImportHash(tx.date, amount, tx.description, accountId, 0, tx.fitid) : null;

		// Sequenced hash for CSV imports without FITID - includes sequence number to distinguish duplicates
		const seqHash = !tx.fitid && seq > 0 ? generateImportHash(tx.date, amount, tx.description, accountId, seq) : null;

		// Primary hash: prefer FITID, then sequenced hash for duplicates, then legacy
		const hash = fitidHash ?? seqHash ?? legacyHash;

		return { tx, amount, hash, legacyHash, fitidHash, seqHash };
	});

	console.log(`[Import] Processing ${transactions.length} transactions for account ${accountId}`);
	console.log(`[Import] Transactions with FITID: ${transactions.filter((t) => t.fitid).length}`);

	// Batch check for existing duplicates in DB - check all hash formats
	const allHashes = txWithHashes.flatMap((t) => {
		const hashes = [t.legacyHash];
		if (t.fitidHash) hashes.push(t.fitidHash);
		if (t.seqHash) hashes.push(t.seqHash);
		return hashes;
	});
	const existingTxs = await db.transaction.findMany({
		where: { importHash: { in: allHashes } },
		select: { importHash: true }
	});
	const existingHashes = new Set(existingTxs.map((t) => t.importHash));

	console.log(`[Import] Found ${existingHashes.size} matching hashes in database`);

	// Separate new transactions from duplicates
	const toInsert: typeof txWithHashes = [];
	for (const item of txWithHashes) {
		// Check all hash formats for duplicates
		const matchedHash =
			item.fitidHash && existingHashes.has(item.fitidHash)
				? item.fitidHash
				: item.seqHash && existingHashes.has(item.seqHash)
					? item.seqHash
					: existingHashes.has(item.legacyHash)
						? item.legacyHash
						: null;

		if (matchedHash) {
			result.skipped++;
			result.duplicates.push(item.tx.description.slice(0, 50));
			const matchType = matchedHash === item.fitidHash ? "fitid" : matchedHash === item.seqHash ? "seq" : "legacy";
			console.log(
				`[Import] SKIPPING DUPLICATE: ${item.tx.date.toISOString().slice(0, 10)} | $${item.amount} | ${item.tx.description.slice(0, 40)} | matched=${matchType}`
			);
		} else {
			toInsert.push(item);
			console.log(
				`[Import] NEW: ${item.tx.date.toISOString().slice(0, 10)} | $${item.amount} | ${item.tx.description.slice(0, 40)} | fitid=${item.tx.fitid || "none"}`
			);
		}
	}

	console.log(`[Import] Will insert ${toInsert.length} new transactions, skip ${result.skipped} duplicates`);

	// Insert all new transactions in a single DB transaction
	if (toInsert.length > 0) {
		const created = await db.$transaction(
			toInsert.map(({ tx, amount, hash }) => {
				// Determine which side the account goes on based on amount sign and account type
				// For ASSET accounts: positive = money in = debit, negative = money out = credit
				// For LIABILITY accounts: positive = charge = debit, negative = payment = credit
				const isDebit = tx.amount > 0;

				return db.transaction.create({
					data: {
						bookId,
						date: tx.date,
						description: tx.description,
						memo: tx.memo,
						amount,
						debitAccountId: isDebit ? accountId : null,
						creditAccountId: isDebit ? null : accountId,
						status: "PENDING",
						importSource: source,
						importHash: hash
					}
				});
			})
		);
		result.imported = toInsert.length;

		// Log the import as a single operation (not undoable via normal undo)
		const changes: Change[] = created.map((tx) => ({
			entityType: "Transaction" as const,
			entityId: tx.id,
			before: null,
			after: serialize(tx)
		}));

		await logOperation(bookId, "IMPORT", `Imported ${created.length} transactions from ${source}`, changes);

		// Apply rules to newly imported transactions
		const txIds = created.map((tx) => tx.id);
		const rulesResult = await applyRules(bookId, { transactionIds: txIds });
		result.rulesApplied = rulesResult.rulesApplied;
		result.transactionsCategorized = rulesResult.transactionsUpdated;
	}

	return result;
}

export async function importOFX(bookId: string, filePath: string, accountId: string): Promise<ImportResult> {
	const account = await getAccount(accountId);
	if (!account) {
		throw new Error(`Account not found: ${accountId}`);
	}

	const transactions = await parseOFX(filePath);
	const source = filePath.split("/").pop() || filePath;

	return importTransactions(bookId, transactions, accountId, source);
}

export async function importCSV(
	bookId: string,
	filePath: string,
	accountId: string,
	mapping: CSVMapping
): Promise<ImportResult> {
	const account = await getAccount(accountId);
	if (!account) {
		throw new Error(`Account not found: ${accountId}`);
	}

	const transactions = await parseCSV(filePath, mapping);
	const source = filePath.split("/").pop() || filePath;

	return importTransactions(bookId, transactions, accountId, source);
}
