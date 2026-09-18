#!/usr/bin/env npx tsx
import { AccountType, AssetType } from "@prisma/client";
import * as accounts from "../src/lib/server/actions/accounts";
import * as transactions from "../src/lib/server/actions/transactions";
import * as taxCategories from "../src/lib/server/actions/taxCategories";
import * as taxModules from "../src/lib/server/actions/taxModules";
import * as rules from "../src/lib/server/actions/rules";
import * as importActions from "../src/lib/server/actions/import";
import * as balanceRecords from "../src/lib/server/actions/balanceRecords";
import * as operationLog from "../src/lib/server/actions/operationLog";
import * as books from "../src/lib/server/actions/books";
import * as bookTransfer from "../src/lib/server/actions/bookTransfer";
import * as taxDocuments from "../src/lib/server/actions/taxDocuments";
import * as taxFacts from "../src/lib/server/actions/taxFacts";
import * as taxYear from "../src/lib/server/actions/taxYear";
import * as businesses from "../src/lib/server/actions/businesses";
import { getTaxReportData } from "../src/lib/server/actions/reports";
import { getTaxReturn } from "../src/lib/server/actions/taxReturn";
import { renderReturnPdf, canRenderYear } from "../src/lib/server/taxReturn/pdf";
import { FORM_PRESETS } from "../src/lib/taxForms";
import { readConfig, writeConfig, getConfigPath, updateConfig } from "../src/lib/server/config";
import * as fs from "fs";
import * as path from "path";
import { CLI_HELP } from "../src/lib/cli-help";
import { getAllModules, getModule, findQuestion } from "../src/lib/server/taxModules";

const args = process.argv.slice(2);

// Extract command - first non-flag argument
function extractCommand(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			// Skip the flag's value if it exists
			const next = args[i + 1];
			if (next && !next.startsWith("--")) {
				i++;
			}
		} else {
			return arg;
		}
	}
	return undefined;
}

const command = extractCommand(args);

function parseArgs(args: string[]): Record<string, string | boolean> {
	const result: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = args[i + 1];
			if (next && !next.startsWith("--")) {
				result[key] = next;
				i++;
			} else {
				result[key] = true;
			}
		}
	}
	return result;
}

function getPositionalArgs(args: string[]): string[] {
	const result: string[] = [];
	let foundCommand = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const next = args[i + 1];
			if (next && !next.startsWith("--")) {
				i++;
			}
		} else {
			// Skip the first positional arg (command)
			if (!foundCommand) {
				foundCommand = true;
				continue;
			}
			result.push(arg);
		}
	}
	return result;
}

function json(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

interface TransactionLike {
	id: string;
	date: Date;
	description: string;
	amount: { toFixed(n: number): string } | number;
	creditAccount?: { path: string } | null;
	debitAccount?: { path: string } | null;
}

function printCondensedTransactions(txs: TransactionLike[]): void {
	for (const tx of txs) {
		const date = tx.date.toISOString().split("T")[0];
		const amount = typeof tx.amount === "number" ? tx.amount.toFixed(2) : tx.amount.toFixed(2);
		const credit = tx.creditAccount?.path ?? "(pending)";
		const debit = tx.debitAccount?.path ?? "(pending)";
		console.log(`${tx.id}\t${date}\t${tx.description}\t$${amount}\t${credit}\t${debit}`);
	}
}

function parseAssetType(type: string): AssetType | null {
	if (type === "null" || type === "none") return null;
	const upper = type.toUpperCase().replace(/-/g, "_") as AssetType;
	if (!["LIQUID", "BROKERAGE", "ROTH_RETIREMENT", "TAX_DEFERRED"].includes(upper)) {
		throw new Error(`Invalid asset type: ${type} (liquid, brokerage, roth_retirement, tax_deferred)`);
	}
	return upper;
}

/** Tax-year commands default to the most recently completed year. */
function resolveYear(opts: Record<string, string | boolean>): number {
	if (opts.year) {
		const year = parseInt(opts.year as string, 10);
		if (Number.isNaN(year)) throw new Error(`Invalid year: ${opts.year}`);
		return year;
	}
	return new Date().getFullYear() - 1;
}

/**
 * --business <id|name> resolved to an id. Undefined when not passed, null
 * for "null"/"none" (clear the assignment).
 */
async function resolveBusinessOpt(bookId: string, opts: Record<string, string | boolean>): Promise<string | null | undefined> {
	const raw = opts.business;
	if (raw === undefined) return undefined;
	if (raw === true || raw === "") throw new Error("--business needs a business id or name");
	if (raw === "null" || raw === "none") return null;
	return (await businesses.resolveBusiness(bookId, raw)).id;
}

/** --percent <n>: the share of an account a business claims; 100 when not passed */
function parsePercent(raw: string | boolean | undefined): number {
	if (raw === undefined) return 100;
	const n = Number(raw);
	if (raw === true || raw === "" || !Number.isFinite(n)) throw new Error("--percent needs a number from 1 to 100");
	return n;
}

function scopeLabel(m: { name: string; businessName: string | null }): string {
	return m.businessName ? `${m.name} — ${m.businessName}` : m.name;
}

function money(n: number): string {
	return `$${n.toFixed(2)}`;
}

function formatFactValue(value: unknown): string {
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(String).join(", ");
	return String(value);
}

function parseAccountType(type: string): AccountType {
	const upper = type.toUpperCase() as AccountType;
	if (!["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].includes(upper)) {
		throw new Error(`Invalid account type: ${type}`);
	}
	return upper;
}

/**
 * Resolve which book to use for CLI commands.
 *
 * Priority:
 * 1. --book <id> flag (explicit)
 * 2. ~/.moneypit config defaultBookId
 * 3. Auto-select if exactly one non-demo book exists
 * 4. Fail with helpful error
 */
async function resolveBookId(opts: Record<string, string | boolean>): Promise<string> {
	// 1. Check --book flag
	if (opts.book && typeof opts.book === "string") {
		const book = await books.getBook(opts.book);
		if (!book) {
			throw new Error(`Book not found: ${opts.book}`);
		}
		return opts.book;
	}

	// 2. Check config file
	const config = readConfig();
	if (config.defaultBookId) {
		const book = await books.getBook(config.defaultBookId);
		if (book) {
			return config.defaultBookId;
		}
		// Config points to deleted book - continue to fallback
	}

	// 3. Auto-select if exactly one non-demo book
	const allBooks = await books.listBooks();
	const nonDemoBooks = allBooks.filter((b) => !b.isDemo);

	if (nonDemoBooks.length === 1) {
		return nonDemoBooks[0].id;
	}

	// 4. Fail with helpful error
	if (allBooks.length === 0) {
		throw new Error('No books found. Create one with: bin/mp book:create "My Finances"');
	}

	if (nonDemoBooks.length === 0) {
		// Only demo books exist
		throw new Error(
			'No non-demo books found. Create one with: bin/mp book:create "My Finances"\n' +
				"Or use a demo book explicitly: bin/mp --book <id> <command>"
		);
	}

	// Multiple non-demo books exist
	const bookList = nonDemoBooks.map((b) => `  ${b.id}  ${b.name}`).join("\n");
	throw new Error(
		"Multiple books found. Specify which to use:\n\n" +
			"Option 1: Use --book flag:\n" +
			"  bin/mp --book <id> <command>\n\n" +
			"Option 2: Set a default:\n" +
			"  bin/mp book:switch <id>\n\n" +
			"Available books:\n" +
			bookList
	);
}

async function main() {
	const opts = parseArgs(args);
	const positional = getPositionalArgs(args);

	switch (command) {
		// === ACCOUNT COMMANDS ===
		case "account:list": {
			const bookId = await resolveBookId(opts);
			const filter: accounts.AccountFilter = {};
			if (opts.type) filter.type = parseAccountType(opts.type as string);
			if (opts.prefix) filter.pathPrefix = opts.prefix as string;
			const accountList = await accounts.listAccounts(bookId, filter);
			if (opts.condensed) {
				const businessNames = new Map((await businesses.listBusinesses(bookId)).map((b) => [b.id, b.name]));
				const links = await businesses.listBusinessAccounts(bookId);
				for (const account of accountList) {
					const tags = links
						.filter((l) => l.accountId === account.id)
						.map((l) => `${businessNames.get(l.businessId) ?? "?"}${l.percent === 100 ? "" : ` ${l.percent}%`}`);
					const business = tags.length > 0 ? `\t[${tags.join(", ")}]` : "";
					console.log(`${account.id}\t${account.type}\t${account.path}${business}`);
				}
			} else {
				json(accountList);
			}
			break;
		}

		case "account:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: account:get <id>");
			const account = await accounts.getAccount(id);
			if (!account) throw new Error(`Account not found: ${id}`);
			json(account);
			break;
		}

		case "account:create": {
			const bookId = await resolveBookId(opts);
			const type = opts.type as string;
			const path = opts.path as string;
			if (!type || !path)
				throw new Error(
					"Usage: account:create --type <type> --path <path> [--tax-category <id>] [--last4 <digits>] [--asset-type <type>] [--business <id|name> [--percent <n>]]"
				);
			const businessId = await resolveBusinessOpt(bookId, opts);
			const account = await accounts.createAccount(bookId, parseAccountType(type), path, {
				taxCategoryId: opts["tax-category"] as string | undefined,
				last4: opts["last4"] as string | undefined,
				assetType: opts["asset-type"] ? (parseAssetType(opts["asset-type"] as string) ?? undefined) : undefined
			});
			if (businessId) await businesses.setBusinessAccount(businessId, account.id, parsePercent(opts.percent));
			json({ ...account, businesses: await businesses.listAccountBusinesses(account.id) });
			break;
		}

		case "account:update": {
			const id = positional[0];
			if (!id)
				throw new Error(
					"Usage: account:update <id> [--path <path>] [--tax-category <id>] [--opening-balance <amount>] [--last4 <digits>] [--business <id|name|null> [--percent <n>]]"
				);
			const data: {
				path?: string;
				taxCategoryId?: string | null;
				openingBalance?: number | null;
				last4?: string | null;
				assetType?: AssetType | null;
			} = {};
			if (opts.path) data.path = opts.path as string;
			// --business attaches the account to that business (at --percent,
			// default 100) alongside any others; --business null detaches it from all
			if (opts.business !== undefined) {
				const existing = await accounts.getAccount(id);
				if (!existing) throw new Error(`Account not found: ${id}`);
				const businessId = await resolveBusinessOpt(existing.bookId, opts);
				if (businessId) await businesses.setBusinessAccount(businessId, id, parsePercent(opts.percent));
				else await businesses.setAccountBusinesses(id, []);
			}
			if (opts["asset-type"] !== undefined) data.assetType = parseAssetType(opts["asset-type"] as string);
			if (opts["tax-category"] !== undefined) {
				data.taxCategoryId = opts["tax-category"] === "null" ? null : (opts["tax-category"] as string);
			}
			if (opts["opening-balance"] !== undefined) {
				data.openingBalance = opts["opening-balance"] === "null" ? null : parseFloat(opts["opening-balance"] as string);
			}
			if (opts["last4"] !== undefined) {
				data.last4 = opts["last4"] === "null" ? null : (opts["last4"] as string);
			}
			json(await accounts.updateAccount(id, data));
			break;
		}

		case "account:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: account:delete <id>");
			await accounts.deleteAccount(id);
			console.log(`Deleted account ${id}`);
			break;
		}

		case "account:tree": {
			const bookId = await resolveBookId(opts);
			const type = opts.type ? parseAccountType(opts.type as string) : undefined;
			json(await accounts.getAccountTree(bookId, type));
			break;
		}

		// === TRANSACTION COMMANDS ===
		case "tx:list": {
			const bookId = await resolveBookId(opts);
			const filter: transactions.TransactionFilter = {};
			if (opts.account) filter.accountId = opts.account as string;
			if (opts.status)
				filter.status = (opts.status as string).toUpperCase() as transactions.TransactionFilter["status"];
			if (opts.from) filter.from = new Date(opts.from as string);
			if (opts.to) filter.to = new Date(opts.to as string);
			if (opts.search) filter.search = opts.search as string;
			if (opts.amount) {
				const amount = parseFloat(opts.amount as string);
				filter.amountMin = amount;
				filter.amountMax = amount;
			}
			if (opts.limit) filter.limit = parseInt(opts.limit as string, 10);
			const txList = await transactions.listTransactions(bookId, filter);
			if (opts.condensed) {
				printCondensedTransactions(txList);
			} else {
				json(txList);
			}
			break;
		}

		case "tx:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tx:get <id>");
			const tx = await transactions.getTransaction(id);
			if (!tx) throw new Error(`Transaction not found: ${id}`);
			json(tx);
			break;
		}

		case "tx:create": {
			const bookId = await resolveBookId(opts);
			const date = opts.date as string;
			const description = opts.description as string;
			const amount = opts.amount as string;
			if (!date || !description || !amount) {
				throw new Error(
					"Usage: tx:create --date <date> --description <desc> --amount <amount> [--debit <id>] [--credit <id>]"
				);
			}
			const tx = await transactions.createTransaction(bookId, {
				date: new Date(date),
				description,
				amount: parseFloat(amount),
				memo: opts.memo as string | undefined,
				debitAccountId: opts.debit as string | undefined,
				creditAccountId: opts.credit as string | undefined,
				status: opts.debit && opts.credit ? "CATEGORIZED" : "PENDING"
			});
			json(tx);
			break;
		}

		case "tx:update": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tx:update <id> [--date <date>] [--description <desc>] [--amount <amount>]");
			const data: transactions.UpdateTransactionData = {};
			if (opts.date) data.date = new Date(opts.date as string);
			if (opts.description) data.description = opts.description as string;
			if (opts.memo !== undefined) data.memo = opts.memo as string;
			if (opts.amount) data.amount = parseFloat(opts.amount as string);
			if (opts.debit !== undefined) data.debitAccountId = opts.debit === "null" ? null : (opts.debit as string);
			if (opts.credit !== undefined) data.creditAccountId = opts.credit === "null" ? null : (opts.credit as string);
			if (opts.status)
				data.status = (opts.status as string).toUpperCase() as transactions.UpdateTransactionData["status"];
			json(await transactions.updateTransaction(id, data));
			break;
		}

		case "tx:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tx:delete <id>");
			await transactions.deleteTransaction(id);
			console.log(`Deleted transaction ${id}`);
			break;
		}

		case "tx:categorize": {
			const ids = positional;
			const debit = opts.debit as string | undefined;
			const credit = opts.credit as string | undefined;
			if (ids.length === 0 || (!debit && !credit)) {
				throw new Error("Usage: tx:categorize <ids...> --debit <account-id> OR --credit <account-id>");
			}
			const side = debit ? "debit" : "credit";
			const accountId = (debit || credit) as string;
			const result = await transactions.categorizeTransactions(ids, accountId, side);
			console.log(`Categorized ${result.updated} transactions`);
			break;
		}

		case "tx:uncategorized": {
			const bookId = await resolveBookId(opts);
			const filter: { accountId?: string; limit?: number } = {};
			if (opts.account) filter.accountId = opts.account as string;
			if (opts.limit) filter.limit = parseInt(opts.limit as string, 10);
			const uncategorized = await transactions.getUncategorized(bookId, filter);
			if (opts.condensed) {
				printCondensedTransactions(uncategorized);
			} else {
				json(uncategorized);
			}
			break;
		}

		case "tx:delete-imported": {
			const bookId = await resolveBookId(opts);
			const source = positional[0] as string | undefined;
			const result = await transactions.deleteImportedTransactions(bookId, source);
			console.log(`Deleted ${result.deleted} imported transactions`);
			break;
		}

		case "tx:merge": {
			const id1 = positional[0];
			const id2 = positional[1];
			if (!id1 || !id2) throw new Error("Usage: tx:merge <id1> <id2>");
			const result = await transactions.mergeTransactions(id1, id2);
			console.log(`Merged transaction ${result.mergedId} into ${result.survivorId}`);
			console.log(`  Debit: ${result.debitAccountId || "(pending)"}`);
			console.log(`  Credit: ${result.creditAccountId || "(pending)"}`);
			break;
		}

		case "tx:unmerge": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tx:unmerge <merged-id>");
			await transactions.unmergeTransaction(id);
			console.log(`Unmerged transaction ${id}`);
			break;
		}

		case "tx:flip": {
			const ids = positional;
			if (ids.length === 0) throw new Error("Usage: tx:flip <ids...>");
			const result = await transactions.flipTransactionAccounts(ids);
			console.log(`Flipped accounts on ${result.updated} transaction${result.updated === 1 ? "" : "s"}`);
			break;
		}

		// === TAX CATEGORY COMMANDS ===
		case "tax:list": {
			const bookId = await resolveBookId(opts);
			const year = opts.year ? parseInt(opts.year as string, 10) : undefined;
			json(await taxCategories.listTaxCategories(bookId, year));
			break;
		}

		case "tax:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tax:get <id>");
			const cat = await taxCategories.getTaxCategory(id);
			if (!cat) throw new Error(`Tax category not found: ${id}`);
			json(cat);
			break;
		}

		case "tax:create": {
			const bookId = await resolveBookId(opts);
			const name = positional[0];
			if (!name) throw new Error("Usage: tax:create <name> [--schedule <ref>] [--year <year>] [--description <desc>]");
			const cat = await taxCategories.createTaxCategory(bookId, {
				name,
				scheduleRef: opts.schedule as string | undefined,
				year: opts.year ? parseInt(opts.year as string, 10) : undefined,
				description: opts.description as string | undefined
			});
			json(cat);
			break;
		}

		case "tax:update": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tax:update <id> [--name <name>] [--schedule <ref>] [--year <year>]");
			const data: taxCategories.UpdateTaxCategoryData = {};
			if (opts.name) data.name = opts.name as string;
			if (opts.schedule) data.scheduleRef = opts.schedule as string;
			if (opts.year) data.year = parseInt(opts.year as string, 10);
			if (opts.description) data.description = opts.description as string;
			json(await taxCategories.updateTaxCategory(id, data));
			break;
		}

		case "tax:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: tax:delete <id>");
			await taxCategories.deleteTaxCategory(id);
			console.log(`Deleted tax category ${id}`);
			break;
		}

			// === TAX DOCUMENT COMMANDS ===
			case "doc:list": {
				const bookId = await resolveBookId(opts);
				const year = opts.year ? resolveYear(opts) : undefined;
				const docs = await taxDocuments.listTaxDocuments(bookId, year);
				if (opts.condensed) {
					for (const doc of docs) {
						const total = doc.lines.reduce((sum, l) => sum + Number(l.amount), 0);
						console.log(
							`${doc.id}\t${doc.year}\t${doc.formType}\t${doc.issuer}\t${doc.status}\t${doc.lines.length} line(s)\t${money(total)}`
						);
					}
				} else {
					json(docs);
				}
				break;
			}

			case "doc:get": {
				const id = positional[0];
				if (!id) throw new Error("Usage: doc:get <id>");
				const doc = await taxDocuments.getTaxDocument(id);
				if (!doc) throw new Error(`Document not found: ${id}`);
				json(doc);
				break;
			}

			case "doc:add": {
				const bookId = await resolveBookId(opts);
				const formType = opts.form as string;
				const issuer = opts.issuer as string;
				if (!formType || !issuer) {
					throw new Error(
						"Usage: doc:add --form <type> --issuer <name> [--year <year>] [--account <id>] [--business <id|name>] [--notes <text>] [--na]"
					);
				}
				const doc = await taxDocuments.createTaxDocument(bookId, {
					year: resolveYear(opts),
					formType,
					issuer,
					accountId: opts.account as string | undefined,
					businessId: await resolveBusinessOpt(bookId, opts),
					notes: opts.notes as string | undefined,
					status: opts.na ? "NOT_APPLICABLE" : "RECEIVED"
				});
				json(doc);
				break;
			}

			case "doc:update": {
				const id = positional[0];
				if (!id)
					throw new Error(
						"Usage: doc:update <id> [--issuer <name>] [--form <type>] [--account <id>] [--business <id|name>] [--notes <text>] [--status received|na]"
					);
				const data: taxDocuments.UpdateTaxDocumentData = {};
				if (opts.business !== undefined) {
					const existing = await taxDocuments.getTaxDocument(id);
					if (!existing) throw new Error(`Document not found: ${id}`);
					data.businessId = await resolveBusinessOpt(existing.bookId, opts);
				}
				if (opts.issuer) data.issuer = opts.issuer as string;
				if (opts.form) data.formType = opts.form as string;
				if (opts.account !== undefined) data.accountId = opts.account === "null" ? null : (opts.account as string);
				if (opts.notes !== undefined) data.notes = opts.notes === "null" ? null : (opts.notes as string);
				if (opts.status) {
					const status = (opts.status as string).toLowerCase();
					data.status = status === "na" || status === "not_applicable" ? "NOT_APPLICABLE" : "RECEIVED";
				}
				json(await taxDocuments.updateTaxDocument(id, data));
				break;
			}

			case "doc:delete": {
				const id = positional[0];
				if (!id) throw new Error("Usage: doc:delete <id>");
				await taxDocuments.deleteTaxDocument(id);
				console.log(`Deleted document ${id}`);
				break;
			}

			case "doc:line": {
				const id = positional[0];
				const box = opts.box as string;
				const amount = opts.amount as string;
				if (!id || !box || amount === undefined) {
					throw new Error("Usage: doc:line <doc-id> --box <box> --amount <amount> [--label <text>] [--category <id|name>] [--no-category]");
				}
				const line = await taxDocuments.addDocumentLine(id, {
					box,
					amount: parseFloat(amount),
					label: opts.label as string | undefined,
					category: opts["no-category"] ? null : (opts.category as string | undefined)
				});
				json(line);
				break;
			}

			case "doc:line-delete": {
				const id = positional[0];
				if (!id) throw new Error("Usage: doc:line-delete <line-id>");
				await taxDocuments.deleteDocumentLine(id);
				console.log(`Deleted line ${id}`);
				break;
			}

			case "doc:attach": {
				const id = positional[0];
				const filePath = positional[1];
				if (id && opts.from) {
					// Share the file already attached to another document (a
					// consolidated 1099 that holds several forms)
					const source = await taxDocuments.getTaxDocument(opts.from as string);
					if (!source) throw new Error(`Document not found: ${opts.from}`);
					if (!source.file) throw new Error(`Document ${source.id} has no file attached`);
					json(await taxDocuments.linkDocumentFile(id, source.file.id));
					break;
				}
				if (!id || !filePath) throw new Error("Usage: doc:attach <doc-id> <file> | doc:attach <doc-id> --from <doc-id>");
				const data = new Uint8Array(fs.readFileSync(filePath));
				const filename = path.basename(filePath);
				const file = await taxDocuments.attachDocumentFile(id, {
					filename,
					mimeType: taxDocuments.documentFileType(filename),
					data
				});
				json(file);
				break;
			}

			case "doc:detach": {
				const id = positional[0];
				if (!id) throw new Error("Usage: doc:detach <doc-id>");
				await taxDocuments.detachDocumentFile(id);
				console.log(`Removed file from document ${id}`);
				break;
			}

			case "doc:forms": {
				for (const [formType, preset] of Object.entries(FORM_PRESETS)) {
					console.log(`${formType}  ${preset.name}`);
					for (const box of preset.boxes) {
						console.log(`    ${box.box.padEnd(4)} ${box.label}`);
					}
				}
				break;
			}

			// === TAX FACT COMMANDS ===
			case "fact:list": {
				const bookId = await resolveBookId(opts);
				const year = resolveYear(opts);
				const status = await taxYear.getTaxYearStatus(bookId, year);
				console.log(`Tax year ${year}`);
				const seen = new Set<string>();
				for (const module of status.modules) {
					console.log(`\n${scopeLabel(module)}`);
					for (const q of module.questions) {
						seen.add(q.key);
						if (!q.visible) continue;
						const answer = q.answered
							? `= ${formatFactValue(q.answer)}${q.answerYear === null ? " (carry-forward)" : ""}`
							: "(unanswered)";
						console.log(`  ${q.key.padEnd(28)} ${q.prompt}  ${answer}`);
					}
				}
				const facts = await taxFacts.listTaxFacts(bookId, year);
				const other = facts.filter((f) => !seen.has(f.key));
				if (other.length > 0) {
					const businessNames = new Map(status.businesses.map((b) => [b.id, b.name]));
					console.log("\nOther facts");
					for (const f of other) {
						const scope = f.businessId ? ` (${businessNames.get(f.businessId) ?? "?"})` : "";
						console.log(`  ${f.key.padEnd(28)}${scope} = ${formatFactValue(f.value)}${f.year === null ? " (carry-forward)" : ""}`);
					}
				}
				break;
			}

			case "fact:get": {
				const bookId = await resolveBookId(opts);
				const key = positional[0];
				if (!key) throw new Error("Usage: fact:get <key> [--year <year>] [--business <id|name>]");
				const fact = await taxFacts.getTaxFact(bookId, resolveYear(opts), key, (await resolveBusinessOpt(bookId, opts)) ?? null);
				if (!fact) throw new Error(`Fact not set: ${key}`);
				json(fact);
				break;
			}

			case "fact:set": {
				const bookId = await resolveBookId(opts);
				const key = positional[0];
				const raw = positional.slice(1).join(" ");
				if (!key || raw === "") throw new Error("Usage: fact:set <key> <value> [--year <year>] [--carry-forward] [--business <id|name>]");
				const question = findQuestion(key)?.question;
				const value = taxFacts.parseFactValue(raw, question?.type, question?.options);
				const year = opts["carry-forward"] ? null : resolveYear(opts);
				const businessId = (await resolveBusinessOpt(bookId, opts)) ?? null;
				const fact = await taxFacts.setTaxFact(bookId, key, value, year, businessId);
				const business = businessId ? ` (${(await businesses.getBusiness(businessId))?.name})` : "";
				console.log(`Set ${key}${business} = ${formatFactValue(fact.value)}${fact.year === null ? " (carry-forward)" : ` for ${fact.year}`}`);
				break;
			}

			case "fact:delete": {
				const bookId = await resolveBookId(opts);
				const key = positional[0];
				if (!key) throw new Error("Usage: fact:delete <key> [--year <year>] [--carry-forward] [--business <id|name>]");
				await taxFacts.deleteTaxFact(
					bookId,
					key,
					opts["carry-forward"] ? null : resolveYear(opts),
					(await resolveBusinessOpt(bookId, opts)) ?? null
				);
				console.log(`Deleted fact ${key}`);
				break;
			}

			// === TAX YEAR COMMANDS ===
			case "tax:status": {
				const bookId = await resolveBookId(opts);
				const year = resolveYear(opts);
				const status = await taxYear.getTaxYearStatus(bookId, year);
				if (opts.json) {
					json(status);
					break;
				}
				console.log(`Tax year ${year}`);
				if (status.businesses.length > 0) {
					console.log(`Businesses: ${status.businesses.map((b) => b.name).join(", ")}`);
				}
				console.log(`\nOpen questions: ${status.openQuestions}`);
				for (const module of status.modules) {
					const tag = module.businessName ? `${module.moduleId} · ${module.businessName}` : module.moduleId;
					for (const q of module.questions) {
						if (q.visible && !q.answered) console.log(`  [${tag}] ${q.key}: ${q.prompt}`);
					}
				}
				const received = status.expectedDocuments.filter((d) => d.status === "received").length;
				const na = status.expectedDocuments.filter((d) => d.status === "not_applicable").length;
				console.log(
					`\nExpected documents: ${status.expectedDocuments.length} (${received} received, ${na} n/a, ${status.missingDocuments} missing)`
				);
				for (const d of status.expectedDocuments) {
					const label = d.status === "received" ? "RECEIVED" : d.status === "not_applicable" ? "N/A     " : "MISSING ";
					console.log(`  ${label}  ${d.formType.padEnd(9)} ${(d.institution || "-").padEnd(20)} ${d.reason}`);
				}
				console.log(`\nDocuments on hand: ${status.documents.length}`);
				for (const doc of status.documents) {
					const total = doc.lines.reduce((sum, l) => sum + Number(l.amount), 0);
					console.log(`  ${doc.id}  ${doc.formType.padEnd(9)} ${doc.issuer.padEnd(20)} ${doc.status}  ${doc.lines.length} line(s)  ${money(total)}`);
					for (const r of status.reconciliations.filter((r) => r.documentId === doc.id)) {
						const label = r.status === "matched" ? "matched " : r.status === "variance" ? "VARIANCE" : "NO TXNS ";
						console.log(
							`      ${label}  box ${r.box.padEnd(4)} ${r.taxCategoryName.padEnd(30)} ${r.accountPath.padEnd(24)} books ${money(r.bookAmount).padStart(11)}  doc ${money(r.documentAmount).padStart(11)}  diff ${money(r.difference).padStart(11)}`
						);
					}
				}
				const untied = status.documents.filter((d) => d.status === "RECEIVED" && !d.accountId && d.lines.length > 0);
				if (untied.length > 0) {
					console.log(`\nNot tied to an account (their lines replace whole categories): ${untied.map((d) => `${d.formType} ${d.issuer}`).join(", ")}`);
				}
				break;
			}

			case "tax:report": {
				const bookId = await resolveBookId(opts);
				json(await getTaxReportData(bookId, resolveYear(opts)));
				break;
			}

			case "return:show": {
				const bookId = await resolveBookId(opts);
				const year = resolveYear(opts);
				const result = await getTaxReturn(bookId, year);
				if (!result.available) {
					console.error(`${result.reason} Tax tables exist for ${result.supportedYears.join(", ")}.`);
					process.exit(1);
				}
				if (opts.json) {
					json(result.computation);
					break;
				}
				const { computation } = result;
				const s = computation.summary;
				console.log(`Draft ${year} federal return (${computation.filingStatusLabel})`);
				console.log(`  Adjusted gross income ${money(s.adjustedGrossIncome).padStart(14)}`);
				console.log(`  ${(s.deductionKind === "itemized" ? "Itemized deductions" : "Standard deduction").padEnd(21)} ${money(s.deduction).padStart(14)}`);
				if (s.qbiDeduction) console.log(`  QBI deduction         ${money(s.qbiDeduction).padStart(14)}`);
				console.log(`  Taxable income        ${money(s.taxableIncome).padStart(14)}`);
				console.log(`  Income tax            ${money(s.incomeTax).padStart(14)}`);
				if (s.selfEmploymentTax) console.log(`  Self-employment tax   ${money(s.selfEmploymentTax).padStart(14)}`);
				console.log(`  Total tax             ${money(s.totalTax).padStart(14)}`);
				if (s.refundableCredits) console.log(`  Refundable credits    ${money(s.refundableCredits).padStart(14)}`);
				console.log(`  Payments              ${money(s.totalPayments).padStart(14)}`);
				console.log(s.refund > 0 ? `  Refund                ${money(s.refund).padStart(14)}` : `  Amount owed           ${money(s.amountOwed).padStart(14)}`);
				for (const form of computation.forms) {
					console.log(`\n${form.name}${form.businessName ? ` — ${form.businessName}` : ""}  (${form.title})`);
					for (const line of form.lines) {
						const unused = line.kind === "input" && line.amount === 0;
						if (unused || (line.kind === "text" && !line.text)) continue;
						const value = line.kind === "text" ? (line.text ?? "") : money(line.amount ?? 0);
						console.log(`  ${line.line.padEnd(10)} ${line.label.padEnd(58)} ${value.padStart(14)}`);
						if (line.detail) console.log(`             ${line.detail}`);
					}
				}
				if (computation.warnings.length > 0) {
					console.log("\nCheck before filing:");
					for (const w of computation.warnings) console.log(`  - ${w}`);
				}
				if (!canRenderYear(year)) console.log(`\nNo IRS forms on file for ${year}; return:pdf is unavailable for this year.`);
				break;
			}

			case "return:pdf": {
				const bookId = await resolveBookId(opts);
				const year = resolveYear(opts);
				const file = positional[0];
				if (!file) throw new Error("Usage: return:pdf <file> [--year <year>]");
				const result = await getTaxReturn(bookId, year);
				if (!result.available) {
					console.error(`${result.reason} Tax tables exist for ${result.supportedYears.join(", ")}.`);
					process.exit(1);
				}
				const bytes = await renderReturnPdf(result.computation);
				fs.writeFileSync(file, bytes);
				console.log(`Wrote ${file}: ${result.computation.forms.map((f) => f.name + (f.businessName ? ` (${f.businessName})` : "")).join(", ")}`);
				if (result.computation.warnings.length > 0) console.log(`${result.computation.warnings.length} item(s) to check; see return:show.`);
				break;
			}

			case "worksheet:list": {
				const bookId = await resolveBookId(opts);
				const year = resolveYear(opts);
				const businessId = (await resolveBusinessOpt(bookId, opts)) ?? null;
				const report = await getTaxReportData(bookId, year);
				const sheets = report.worksheets.filter((w) => !businessId || w.businessId === businessId);
				if (opts.json) {
					json(sheets);
					break;
				}
				console.log(`Worksheets for ${year}`);
				if (sheets.length === 0) console.log("  (none: no enabled module worksheet has the facts it needs)");
				for (const w of sheets) {
					console.log(`\n${w.name}${w.businessName ? ` — ${w.businessName}` : ""}  [${w.worksheetId}]`);
					for (const row of w.breakdown) {
						const amount = row.amount === null ? "" : row.kind === "input" ? String(row.amount) : money(row.amount);
						const label = row.detail ? `${row.label} (${row.detail})` : row.label;
						console.log(`  ${(row.kind === "allocation" ? "  " : "") + label.padEnd(60)} ${amount.padStart(14)}`);
					}
					for (const line of w.lines) console.log(`  → ${line.category}: ${money(line.amount)}`);
				}
				// Claims are checked across businesses, so the warnings are not filtered
				if (report.worksheetWarnings.length > 0) {
					console.log("\nCheck:");
					for (const w of report.worksheetWarnings) console.log(`  ! ${w}`);
				}
				break;
			}

		// === BUSINESS COMMANDS ===
		case "business:list": {
			const bookId = await resolveBookId(opts);
			const list = await businesses.listBusinesses(bookId);
			if (opts.condensed) {
				for (const b of list) console.log(`${b.id}\t${b.name}\t${b.accountCount} account(s)`);
			} else {
				json(list);
			}
			break;
		}

		case "business:get": {
			const bookId = await resolveBookId(opts);
			const idOrName = positional[0];
			if (!idOrName) throw new Error("Usage: business:get <id|name>");
			const business = await businesses.resolveBusiness(bookId, idOrName);
			const links = (await businesses.listBusinessAccounts(bookId)).filter((l) => l.businessId === business.id);
			const accountList = await accounts.listAccounts(bookId);
			json({
				...business,
				accounts: links.flatMap((l) => {
					const a = accountList.find((x) => x.id === l.accountId);
					return a ? [{ id: a.id, type: a.type, path: a.path, percent: l.percent }] : [];
				})
			});
			break;
		}

		case "business:create": {
			const bookId = await resolveBookId(opts);
			const name = positional.join(" ");
			if (!name) throw new Error("Usage: business:create <name>");
			const result = await businesses.createBusiness(bookId, name);
			if (opts.json) {
				json(result);
				break;
			}
			console.log(`Created business ${result.business.name} (${result.business.id})`);
			if (result.adoptedAccounts > 0 || result.adoptedFacts > 0) {
				console.log(
					`Adopted ${result.adoptedAccounts} account(s) and ${result.adoptedFacts} answer(s) that belonged to the book's single implicit business`
				);
			}
			break;
		}

		case "business:update": {
			const bookId = await resolveBookId(opts);
			const idOrName = positional[0];
			if (!idOrName || !opts.name) throw new Error("Usage: business:update <id|name> --name <name>");
			const business = await businesses.resolveBusiness(bookId, idOrName);
			json(await businesses.updateBusiness(business.id, { name: opts.name as string }));
			break;
		}

		case "business:delete": {
			const bookId = await resolveBookId(opts);
			const idOrName = positional[0];
			if (!idOrName) throw new Error("Usage: business:delete <id|name>");
			const business = await businesses.resolveBusiness(bookId, idOrName);
			await businesses.deleteBusiness(business.id);
			console.log(`Deleted business ${business.name}; its accounts are detached and its documents have no business`);
			break;
		}

		case "business:assign": {
			const bookId = await resolveBookId(opts);
			const [idOrName, ...accountIds] = positional;
			if (!idOrName || accountIds.length === 0) throw new Error("Usage: business:assign <id|name> <account-ids...> [--percent <n>]");
			const business = await businesses.resolveBusiness(bookId, idOrName);
			const percent = parsePercent(opts.percent);
			for (const accountId of accountIds) {
				const account = await accounts.getAccount(accountId);
				if (!account || account.bookId !== bookId) throw new Error(`Account not found: ${accountId}`);
				await businesses.setBusinessAccount(business.id, accountId, percent);
				console.log(`${account.path} -> ${business.name} at ${percent}%`);
			}
			break;
		}

		case "business:unassign": {
			const bookId = await resolveBookId(opts);
			const [idOrName, ...accountIds] = positional;
			if (!idOrName || accountIds.length === 0) throw new Error("Usage: business:unassign <id|name> <account-ids...>");
			const business = await businesses.resolveBusiness(bookId, idOrName);
			for (const accountId of accountIds) {
				const account = await accounts.getAccount(accountId);
				if (!account || account.bookId !== bookId) throw new Error(`Account not found: ${accountId}`);
				await businesses.removeBusinessAccount(business.id, accountId);
				console.log(`${account.path} -/-> ${business.name}`);
			}
			break;
		}

		// === RULE COMMANDS ===
		case "rule:list": {
			const bookId = await resolveBookId(opts);
			const ruleList = await rules.listRules(bookId);
			if (opts.condensed) {
				for (const rule of ruleList) {
					const flags = [];
					if (rule.isRegex) flags.push("regex");
					if (rule.field !== "description") flags.push(`field:${rule.field}`);
					if (rule.amountExact !== null) flags.push(`=$${Number(rule.amountExact).toFixed(2)}`);
					else if (rule.amountMin !== null || rule.amountMax !== null) {
						const min = rule.amountMin !== null ? `$${Number(rule.amountMin).toFixed(2)}` : "0";
						const max = rule.amountMax !== null ? `$${Number(rule.amountMax).toFixed(2)}` : "∞";
						flags.push(`${min}-${max}`);
					}
					const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
					console.log(`${rule.id}\t"${rule.pattern}"${flagStr}\t→ ${rule.account.type}:${rule.account.path}`);
				}
			} else {
				json(ruleList);
			}
			break;
		}

		case "rule:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: rule:get <id>");
			const rule = await rules.getRule(id);
			if (!rule) throw new Error(`Rule not found: ${id}`);
			json(rule);
			break;
		}

		case "rule:create": {
			const bookId = await resolveBookId(opts);
			const pattern = positional[0];
			const accountId = opts.account as string;
			if (!pattern || !accountId) {
				throw new Error("Usage: rule:create <pattern> --account <id> [--regex] [--field <field>] [--priority <n>]");
			}
			const rule = await rules.createRule(bookId, pattern, accountId, {
				isRegex: !!opts.regex,
				field: opts.field as string | undefined,
				priority: opts.priority ? parseInt(opts.priority as string, 10) : undefined,
				amountMin: opts["amount-min"] ? parseFloat(opts["amount-min"] as string) : undefined,
				amountMax: opts["amount-max"] ? parseFloat(opts["amount-max"] as string) : undefined,
				amountExact: opts["amount-exact"] ? parseFloat(opts["amount-exact"] as string) : undefined
			});
			json(rule);
			break;
		}

		case "rule:update": {
			const id = positional[0];
			if (!id)
				throw new Error("Usage: rule:update <id> [--pattern <pattern>] [--account <id>] [--regex] [--field <field>]");
			const data: rules.UpdateRuleData = {};
			if (opts.pattern) data.pattern = opts.pattern as string;
			if (opts.account) data.accountId = opts.account as string;
			if (opts.regex !== undefined) data.isRegex = !!opts.regex;
			if (opts.field) data.field = opts.field as string;
			if (opts.priority) data.priority = parseInt(opts.priority as string, 10);
			json(await rules.updateRule(id, data));
			break;
		}

		case "rule:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: rule:delete <id>");
			await rules.deleteRule(id);
			console.log(`Deleted rule ${id}`);
			break;
		}

		case "rule:test": {
			const bookId = await resolveBookId(opts);
			const pattern = positional[0];
			if (!pattern) throw new Error("Usage: rule:test <pattern> [--field <field>] [--regex] [--include-categorized]");
			const matches = await rules.testRule(
				bookId,
				pattern,
				opts.field as string | undefined,
				!!opts.regex,
				!!opts["include-categorized"]
			);
			json(matches);
			break;
		}

		case "rule:apply": {
			const bookId = await resolveBookId(opts);
			const accountId = opts.account as string | undefined;
			const result = await rules.applyRules(bookId, { accountId });
			if (result.transactionsUpdated > 0) {
				console.log(`Applied ${result.rulesApplied} rule(s) to ${result.transactionsUpdated} transaction(s)`);
			} else {
				console.log("No pending transactions matched any rules");
			}
			break;
		}

		// === IMPORT COMMANDS ===
		case "import:ofx": {
			const bookId = await resolveBookId(opts);
			const filePath = positional[0];
			const accountId = opts.account as string;
			if (!filePath || !accountId) {
				throw new Error("Usage: import:ofx <file> --account <id>");
			}
			const result = await importActions.importOFX(bookId, filePath, accountId);
			console.log(`Imported ${result.imported} transactions, skipped ${result.skipped} duplicates`);
			if (result.transactionsCategorized && result.transactionsCategorized > 0) {
				console.log(`Applied ${result.rulesApplied} rule(s) to ${result.transactionsCategorized} transaction(s)`);
			}
			if (result.duplicates.length > 0 && result.duplicates.length <= 10) {
				console.log("Duplicates:", result.duplicates.join(", "));
			}
			break;
		}

		case "import:csv": {
			const bookId = await resolveBookId(opts);
			const filePath = positional[0];
			const accountId = opts.account as string;
			const mapping = opts.mapping as string | undefined;
			if (!filePath || !accountId || !mapping) {
				throw new Error("Usage: import:csv <file> --account <id> --mapping <json>");
			}
			const csvMapping = JSON.parse(mapping);
			const result = await importActions.importCSV(bookId, filePath, accountId, csvMapping);
			console.log(`Imported ${result.imported} transactions, skipped ${result.skipped} duplicates`);
			if (result.transactionsCategorized && result.transactionsCategorized > 0) {
				console.log(`Applied ${result.rulesApplied} rule(s) to ${result.transactionsCategorized} transaction(s)`);
			}
			if (result.duplicates.length > 0 && result.duplicates.length <= 10) {
				console.log("Duplicates:", result.duplicates.join(", "));
			}
			break;
		}

		case "import:preview": {
			const filePath = positional[0];
			const limit = opts.limit ? parseInt(opts.limit as string, 10) : 10;
			if (!filePath) {
				throw new Error("Usage: import:preview <file> [--limit <n>]");
			}
			const preview = await importActions.previewCSV(filePath, limit);
			console.log("Headers:", preview.headers.join(", "));
			console.log("\nFirst", preview.rows.length, "rows:");
			json(preview.rows);
			break;
		}

		// === BALANCE RECORD COMMANDS ===
		case "balance:list": {
			const accountId = positional[0];
			if (!accountId) throw new Error("Usage: balance:list <account-id>");
			const records = await balanceRecords.listBalanceRecords(accountId);
			json(records);
			break;
		}

		case "balance:add": {
			const accountId = opts.account as string;
			const date = opts.date as string;
			const balance = opts.balance as string;
			const note = opts.note as string | undefined;
			if (!accountId || !date || !balance) {
				throw new Error("Usage: balance:add --account <id> --date <date> --balance <amount> [--note <text>]");
			}
			const record = await balanceRecords.createBalanceRecord(accountId, new Date(date), parseFloat(balance), note);
			json(record);
			break;
		}

		case "balance:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: balance:delete <id>");
			await balanceRecords.deleteBalanceRecord(id);
			console.log(`Deleted balance record ${id}`);
			break;
		}

		case "balance:check": {
			const accountId = positional[0];
			const date = opts.date as string;
			if (!accountId) throw new Error("Usage: balance:check <account-id> [--date <date>]");
			const asOf = date ? new Date(date) : new Date();
			const calculated = await balanceRecords.getCalculatedBalanceAsOf(accountId, asOf);
			console.log(`Calculated balance as of ${asOf.toISOString().split("T")[0]}: $${calculated.toFixed(2)}`);
			break;
		}

		// === OPERATION LOG COMMANDS ===
		case "log:list": {
			const bookId = await resolveBookId(opts);
			const limit = opts.limit ? parseInt(opts.limit as string, 10) : 20;
			const { operations: logs } = await operationLog.getRecentOperations(bookId, limit);
			for (const log of logs) {
				const undone = log.undoneAt ? " [UNDONE]" : "";
				const changes = (log.changes as operationLog.Change[]).length;
				console.log(
					`${log.id}  ${log.createdAt.toISOString().slice(0, 19)}  ${log.operation.padEnd(10)}  ${changes} change(s)${undone}`
				);
				console.log(`    ${log.description}`);
			}
			break;
		}

		case "log:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: log:get <id>");
			const log = await operationLog.getOperation(id);
			if (!log) throw new Error(`Operation not found: ${id}`);
			json(log);
			break;
		}

		case "log:undo": {
			const id = positional[0];
			if (!id) throw new Error("Usage: log:undo <id>");
			const result = await operationLog.undoOperation(id);
			console.log(`Undone: ${result.undone} change(s), skipped: ${result.skipped}`);
			break;
		}

		// === BOOK COMMANDS ===
		case "book:list": {
			const bookList = await books.listBooks();
			const config = readConfig();
			for (const book of bookList) {
				const current = book.id === config.defaultBookId ? " (current)" : "";
				const demo = book.isDemo ? " [demo]" : "";
				console.log(`${book.id}  ${book.name}${demo}${current}`);
				if (book.description) console.log(`    ${book.description}`);
			}
			break;
		}

		case "book:get": {
			const id = positional[0];
			if (!id) throw new Error("Usage: book:get <id>");
			const book = await books.getBook(id);
			if (!book) throw new Error(`Book not found: ${id}`);
			json(book);
			break;
		}

		case "book:create": {
			const name = positional[0];
			if (!name) throw new Error("Usage: book:create <name> [--description <desc>] [--demo]");
			const book = await books.createBook({
				name,
				description: opts.description as string | undefined,
				isDemo: !!opts.demo
			});
			json(book);
			break;
		}

		case "book:update": {
			const id = positional[0];
			if (!id) throw new Error("Usage: book:update <id> [--name <name>] [--description <desc>]");
			const data: books.UpdateBookData = {};
			if (opts.name) data.name = opts.name as string;
			if (opts.description) data.description = opts.description as string;
			json(await books.updateBook(id, data));
			break;
		}

		case "book:delete": {
			const id = positional[0];
			if (!id) throw new Error("Usage: book:delete <id>");

			const book = await books.getBook(id);
			if (!book) throw new Error(`Book not found: ${id}`);

			if (!opts.force) {
				const readline = await import("readline");
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout
				});
				const answer = await new Promise<string>((resolve) => {
					rl.question(
						`This will permanently delete "${book.name}" and all its data. Type the book name to confirm: `,
						resolve
					);
				});
				rl.close();
				if (answer !== book.name) {
					console.log("Deletion cancelled.");
					break;
				}
			}

			await books.deleteBook(id);
			console.log(`Deleted book ${id}`);
			break;
		}

		case "book:switch": {
			const id = positional[0];
			if (!id) throw new Error("Usage: book:switch <id>");
			const book = await books.getBook(id);
			if (!book) throw new Error(`Book not found: ${id}`);
			updateConfig({ defaultBookId: id });
			console.log(`Switched to book: ${book.name}`);
			break;
		}

		case "book:current": {
			const config = readConfig();
			if (!config.defaultBookId) {
				const defaultBook = await books.getDefaultBook();
				console.log(`${defaultBook.name} (default - no explicit selection)`);
			} else {
				const book = await books.getBook(config.defaultBookId);
				if (book) {
					console.log(`${book.name} (${book.id})`);
				} else {
					console.log(`Book ${config.defaultBookId} not found`);
				}
			}
			break;
		}

		case "book:export": {
			const bookId = await resolveBookId(opts);
			const outputPath = positional[0];
			if (!outputPath) throw new Error("Usage: book:export <output-file.json>");
			const exportData = await bookTransfer.exportBook(bookId);
			fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
			console.log(`Exported book to ${outputPath}`);
			console.log(`  Accounts: ${exportData.accounts.length}`);
			console.log(`  Transactions: ${exportData.transactions.length}`);
			console.log(`  Rules: ${exportData.rules.length}`);
			console.log(`  Tax Categories: ${exportData.taxCategories.length}`);
			break;
		}

		case "book:import": {
			const inputPath = positional[0];
			if (!inputPath) throw new Error("Usage: book:import <input-file.json> [--name <name>]");
			if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`);
			const fileContent = fs.readFileSync(inputPath, "utf-8");
			const importData = JSON.parse(fileContent) as bookTransfer.BookExport;
			const result = await bookTransfer.importBook(importData, {
				name: opts.name as string | undefined
			});
			console.log(`Imported book: ${result.bookName} (${result.bookId})`);
			console.log(`  Accounts: ${result.accounts}`);
			console.log(`  Transactions: ${result.transactions}`);
			console.log(`  Rules: ${result.rules}`);
			console.log(`  Tax Categories: ${result.taxCategories}`);
			console.log(`  Balance Records: ${result.balanceRecords}`);
			console.log(`  Enabled Modules: ${result.enabledModules}`);
			console.log(`  Tax Documents: ${result.taxDocuments}`);
			console.log(`  Tax Facts: ${result.taxFacts}`);
			console.log(`  Businesses: ${result.businesses}`);
			console.log(`  Businesses: ${result.businesses}`);
			break;
		}

		// === TAX MODULE COMMANDS ===
		case "module:list": {
			const modules = getAllModules();
			const groups = {
				"us-federal": "US Federal",
				"us-state": "US State",
				corporate: "Corporate"
			};
			for (const group of ["us-federal", "us-state", "corporate"] as const) {
				const groupModules = modules.filter((m) => m.group === group);
				if (groupModules.length > 0) {
					console.log(`\n${groups[group]}:`);
					for (const m of groupModules) {
						console.log(`  ${m.id}`);
						console.log(`    ${m.name}`);
						console.log(`    ${m.description}`);
						console.log(`    Categories: ${m.categories.length}, Questions: ${m.questions?.length ?? 0}`);
					}
				}
			}
			break;
		}

		case "module:enabled": {
			const bookId = await resolveBookId(opts);
			const enabled = await taxModules.getEnabledModules(bookId);
			if (enabled.length === 0) {
				console.log("No modules enabled for this book");
			} else {
				for (const e of enabled) {
					console.log(`${e.moduleId}`);
					console.log(`  ${e.module.name}`);
					console.log(`  Enabled: ${e.enabledAt.toISOString().split("T")[0]}`);
				}
			}
			break;
		}

		case "module:enable": {
			const bookId = await resolveBookId(opts);
			const moduleId = positional[0];
			if (!moduleId) throw new Error("Usage: module:enable <module-id>");
			const module = getModule(moduleId);
			if (!module) {
				const available = getAllModules()
					.map((m) => m.id)
					.join(", ");
				throw new Error(`Unknown module: ${moduleId}\nAvailable: ${available}`);
			}
			const result = await taxModules.enableModule(bookId, moduleId);
			if (result.categoriesCreated > 0) {
				console.log(`Enabled ${module.name}`);
				console.log(`Created ${result.categoriesCreated} tax categories`);
			} else {
				console.log(`Module ${module.name} already enabled (no new categories created)`);
			}
			break;
		}

		case "module:disable": {
			const bookId = await resolveBookId(opts);
			const moduleId = positional[0];
			if (!moduleId) throw new Error("Usage: module:disable <module-id>");
			const module = getModule(moduleId);
			if (!module) throw new Error(`Unknown module: ${moduleId}`);
			const result = await taxModules.disableModule(bookId, moduleId);
			console.log(`Disabled ${module.name}`);
			console.log(`Deleted ${result.categoriesDeleted} categories`);
			if (result.categoriesRetained > 0) {
				console.log(`Retained ${result.categoriesRetained} categories (in use by accounts):`);
				for (const cat of result.retainedCategories) {
					console.log(`  - ${cat.name} (${cat.accountCount} accounts)`);
				}
			}
			break;
		}

		// === CONFIG COMMANDS ===
		case "config:show": {
			const config = readConfig();
			json(config);
			break;
		}

		case "config:path": {
			console.log(getConfigPath());
			break;
		}

		case "config:set": {
			const key = positional[0];
			const value = positional[1];
			if (!key || value === undefined) {
				throw new Error("Usage: config:set <key> <value>");
			}
			const config = readConfig();
			(config as Record<string, unknown>)[key] = value;
			writeConfig(config);
			console.log(`Set ${key} = ${value}`);
			break;
		}

		case "help":
		case "--help":
		case undefined: {
			console.log(CLI_HELP);
			break;
		}

		default:
			console.error(`Unknown command: ${command}`);
			console.error('Run "bin/mp help" for usage');
			process.exit(1);
	}
}

main()
	.catch((err) => {
		console.error("Error:", err.message);
		process.exit(1);
	})
	.finally(() => {
		process.exit(0);
	});
