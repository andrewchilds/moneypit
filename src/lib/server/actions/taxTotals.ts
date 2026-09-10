import { db } from '../db';
import type { AccountType } from '@prisma/client';

/**
 * An income or expense account's year total, split by the account on the
 * other side of its transactions (the asset account a dividend landed in,
 * the card an expense was paid with). Summing an account's rows gives the
 * figure the tax report shows for it.
 */
export interface AccountCounterpartyTotal {
	accountId: string;
	/** Null when the other side is still uncategorized */
	counterpartyId: string | null;
	/** Net amount counted for the tax report */
	total: number;
	/** Net amount left out because the counterparty is a retirement account */
	excluded: number;
}

/**
 * Per-(account, counterparty) totals for every INCOME and EXPENSE account in
 * the book for a year. Income accounts are normally credited and expense
 * accounts debited, but refunds and reversals land on the opposite side, so
 * the two directions are netted. Money earned inside a retirement account
 * (dividends in an IRA) is not taxable when earned, so amounts whose other
 * side is a ROTH_RETIREMENT or TAX_DEFERRED asset account are reported in
 * `excluded` rather than `total`. Merged transactions are skipped.
 */
export async function getTaxAccountTotals(bookId: string, year: number): Promise<AccountCounterpartyTotal[]> {
	const startDate = new Date(year, 0, 1);
	const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
	const rows = await db.$queryRaw<{ accountId: string; counterpartyId: string | null; total: number; excluded: number }[]>`
		SELECT
			signed."accountId",
			signed."counterpartyId",
			COALESCE(SUM(signed.amount) FILTER (WHERE NOT signed.retirement), 0) as total,
			COALESCE(SUM(signed.amount) FILTER (WHERE signed.retirement), 0) as excluded
		FROM (
			SELECT
				a.id as "accountId",
				other.id as "counterpartyId",
				CASE
					WHEN a.type = 'INCOME' AND t."creditAccountId" = a.id THEN t.amount
					WHEN a.type = 'EXPENSE' AND t."debitAccountId" = a.id THEN t.amount
					ELSE -t.amount
				END as amount,
				COALESCE(other."assetType"::text IN ('ROTH_RETIREMENT', 'TAX_DEFERRED'), false) as retirement
			FROM "Account" a
			JOIN "Transaction" t ON (t."debitAccountId" = a.id OR t."creditAccountId" = a.id)
			LEFT JOIN "Account" other ON other.id = CASE
				WHEN t."debitAccountId" = a.id THEN t."creditAccountId"
				ELSE t."debitAccountId"
			END
			WHERE a."bookId" = ${bookId}
			AND a.type IN ('INCOME', 'EXPENSE')
			AND t.date >= ${startDate}
			AND t.date <= ${endDate}
			AND t."merged_into_id" IS NULL
		) signed
		GROUP BY signed."accountId", signed."counterpartyId"
	`;
	return rows.map((r) => ({
		accountId: r.accountId,
		counterpartyId: r.counterpartyId,
		total: Number(r.total),
		excluded: Number(r.excluded)
	}));
}

export interface OverlayRow {
	accountId: string;
	counterpartyId: string | null;
	total: number;
}

export interface OverlayLine {
	/** Account the document was issued for, or null when it wasn't tied to one */
	accountId: string | null;
	amount: number;
}

export interface OverlayResult {
	bookTotal: number;
	documentTotal: number;
	/** How much of the book total the documents replace */
	bookReplaced: number;
	reportedTotal: number;
}

/** The rows of a category attributable to an account: its own rows, or rows whose other side is that account. */
function attributable(rows: OverlayRow[], accountId: string): OverlayRow[] {
	return rows.filter((r) => r.accountId === accountId || r.counterpartyId === accountId);
}

/** The book figure for one account within a category's rows. */
export function bookFigureForAccount(rows: OverlayRow[], accountId: string): { amount: number; hasRows: boolean } {
	const matched = attributable(rows, accountId);
	return { amount: matched.reduce((sum, r) => sum + r.total, 0), hasRows: matched.length > 0 };
}

/**
 * Overlay document figures on a category's book rows.
 *
 * A document tied to an account replaces only the book total attributable
 * to that account (transactions whose asset side is that account, or the
 * account itself when the document points at the income/expense account);
 * the rest of the books stays, so a 1099-DIV from one broker doesn't wipe
 * out dividends recorded from another. A document with no account replaces
 * the whole category. On expense categories a document whose account has no
 * rows in the category also replaces the category, since a deduction form
 * (1098, 1095-A) is the authoritative figure whichever account paid it.
 */
export function overlayDocumentFigures(accountType: AccountType, rows: OverlayRow[], lines: OverlayLine[]): OverlayResult {
	const bookTotal = rows.reduce((sum, r) => sum + r.total, 0);
	const documentTotal = lines.reduce((sum, l) => sum + l.amount, 0);

	let bookReplaced: number;
	if (lines.some((l) => l.accountId === null)) {
		bookReplaced = bookTotal;
	} else {
		const replaced = new Set<OverlayRow>();
		let wholeCategory = false;
		for (const accountId of new Set(lines.map((l) => l.accountId!))) {
			const matched = attributable(rows, accountId);
			if (matched.length === 0 && accountType === 'EXPENSE') {
				wholeCategory = true;
				break;
			}
			for (const r of matched) replaced.add(r);
		}
		bookReplaced = wholeCategory ? bookTotal : Array.from(replaced).reduce((sum, r) => sum + r.total, 0);
	}

	return { bookTotal, documentTotal, bookReplaced, reportedTotal: bookTotal - bookReplaced + documentTotal };
}
