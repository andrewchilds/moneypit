import { db } from '../db';
import { Prisma } from '@prisma/client';
import type { AssetType, AccountType } from '@prisma/client';
import { getDocumentTotalsByCategory, type DocumentLineRef } from './taxDocuments';
import { getTaxYearStatus } from './taxYear';
import { getEnabledModules } from './taxModules';
import { getTaxAccountTotals, overlayDocumentFigures, type OverlayRow } from './taxTotals';
import { perBusinessSchedules, scheduleOf } from '../taxModules';
import type { FactValue, WorksheetBreakdownRow, WorksheetLine } from '../taxModules';

export interface StackedBarSegment {
	label: string;
	value: number;
}

export interface MonthlyStackedData {
	month: string; // YYYY-MM
	segments: StackedBarSegment[];
	total: number;
}

export interface NetWorthData {
	assets: {
		byAssetType: MonthlyStackedData[];
		byAccount: MonthlyStackedData[];
	};
	liabilities: {
		byAccount: MonthlyStackedData[];
	};
}

/**
 * Get net worth data over time, grouped by month.
 * For assets, provides both by-AssetType and by-account breakdowns.
 * For liabilities, provides by-account breakdown.
 */
export async function getNetWorthOverTime(bookId: string): Promise<NetWorthData> {
	// Get all asset and liability accounts
	const accounts = await db.account.findMany({
		where: {
			bookId,
			type: { in: ['ASSET', 'LIABILITY'] }
		},
		select: {
			id: true,
			type: true,
			path: true,
			assetType: true,
			openingBalance: true
		}
	});

	const assetAccounts = accounts.filter((a) => a.type === 'ASSET');
	const liabilityAccounts = accounts.filter((a) => a.type === 'LIABILITY');

	if (accounts.length === 0) {
		return {
			assets: { byAssetType: [], byAccount: [] },
			liabilities: { byAccount: [] }
		};
	}

	// Get all months that have any transactions (we'll filter by account in memory)
	const monthsResult = await db.$queryRaw<{ month: string }[]>`
		SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') as month
		FROM "Transaction"
		WHERE "bookId" = ${bookId}
			AND "merged_into_id" IS NULL
		ORDER BY month ASC
	`;

	// If no transactions, return empty
	if (monthsResult.length === 0) {
		return {
			assets: { byAssetType: [], byAccount: [] },
			liabilities: { byAccount: [] }
		};
	}

	const months = monthsResult.map((r) => r.month);

	// Calculate end-of-month balance for each account for each month
	// We need cumulative balances, so we'll compute running totals

	// Get monthly activity per account - simplified query that gets both sides
	const monthlyActivity = await db.$queryRaw<
		{ accountId: string; month: string; debits: number; credits: number }[]
	>`
		WITH debit_activity AS (
			SELECT "debitAccountId" as "accountId", TO_CHAR(date, 'YYYY-MM') as month, SUM(amount) as amount
			FROM "Transaction"
			WHERE "debitAccountId" IS NOT NULL AND "merged_into_id" IS NULL
			GROUP BY "debitAccountId", TO_CHAR(date, 'YYYY-MM')
		),
		credit_activity AS (
			SELECT "creditAccountId" as "accountId", TO_CHAR(date, 'YYYY-MM') as month, SUM(amount) as amount
			FROM "Transaction"
			WHERE "creditAccountId" IS NOT NULL AND "merged_into_id" IS NULL
			GROUP BY "creditAccountId", TO_CHAR(date, 'YYYY-MM')
		)
		SELECT
			COALESCE(d."accountId", c."accountId") as "accountId",
			COALESCE(d.month, c.month) as month,
			COALESCE(d.amount, 0) as debits,
			COALESCE(c.amount, 0) as credits
		FROM debit_activity d
		FULL OUTER JOIN credit_activity c ON d."accountId" = c."accountId" AND d.month = c.month
	`;

	// Build a map: accountId -> month -> { debits, credits }
	const activityMap = new Map<string, Map<string, { debits: number; credits: number }>>();
	for (const row of monthlyActivity) {
		if (!activityMap.has(row.accountId)) {
			activityMap.set(row.accountId, new Map());
		}
		activityMap.get(row.accountId)!.set(row.month, {
			debits: Number(row.debits),
			credits: Number(row.credits)
		});
	}

	// Calculate running balances per account per month
	// accountId -> month -> endBalance
	const balanceMap = new Map<string, Map<string, number>>();

	for (const account of accounts) {
		const accountActivity = activityMap.get(account.id) || new Map();
		const openingBalance = Number(account.openingBalance ?? 0);
		let runningBalance = openingBalance;
		const monthBalances = new Map<string, number>();

		for (const month of months) {
			const activity = accountActivity.get(month) || { debits: 0, credits: 0 };
			// Use same formula as Accounts page: openingBalance + debits - credits
			// For liabilities, opening balance is typically negative (representing debt)
			runningBalance += activity.debits - activity.credits;
			monthBalances.set(month, runningBalance);
		}

		balanceMap.set(account.id, monthBalances);
	}

	// Build assets by AssetType
	const assetTypeLabels: Record<AssetType, string> = {
		LIQUID: 'Liquid',
		BROKERAGE: 'Brokerage',
		ROTH_RETIREMENT: 'Roth Retirement',
		TAX_DEFERRED: 'Tax-Deferred'
	};
	const assetTypes: AssetType[] = ['LIQUID', 'BROKERAGE', 'ROTH_RETIREMENT', 'TAX_DEFERRED'];

	const assetsByType: MonthlyStackedData[] = months.map((month) => {
		const segments: StackedBarSegment[] = [];
		let total = 0;

		for (const assetType of assetTypes) {
			const accountsOfType = assetAccounts.filter((a) => a.assetType === assetType);
			let typeTotal = 0;
			for (const account of accountsOfType) {
				typeTotal += balanceMap.get(account.id)?.get(month) ?? 0;
			}
			if (typeTotal !== 0) {
				segments.push({ label: assetTypeLabels[assetType], value: typeTotal });
				total += typeTotal;
			}
		}

		// Include accounts without assetType
		const uncategorizedAccounts = assetAccounts.filter((a) => !a.assetType);
		let uncategorizedTotal = 0;
		for (const account of uncategorizedAccounts) {
			uncategorizedTotal += balanceMap.get(account.id)?.get(month) ?? 0;
		}
		if (uncategorizedTotal !== 0) {
			segments.push({ label: 'Other', value: uncategorizedTotal });
			total += uncategorizedTotal;
		}

		return { month, segments, total };
	});

	// Build assets by account
	const assetsByAccount: MonthlyStackedData[] = months.map((month) => {
		const segments: StackedBarSegment[] = [];
		let total = 0;

		for (const account of assetAccounts) {
			const balance = balanceMap.get(account.id)?.get(month) ?? 0;
			if (balance !== 0) {
				segments.push({ label: account.path, value: balance });
				total += balance;
			}
		}

		// Sort by value descending for consistent ordering
		segments.sort((a, b) => b.value - a.value);

		return { month, segments, total };
	});

	// Build liabilities by account
	// Note: Liability balances may be stored as negative (representing debt)
	// We show absolute values since for net worth we care about amount owed
	const liabilitiesByAccount: MonthlyStackedData[] = months.map((month) => {
		const segments: StackedBarSegment[] = [];
		let total = 0;

		for (const account of liabilityAccounts) {
			const rawBalance = balanceMap.get(account.id)?.get(month) ?? 0;
			// Use absolute value - negative balances represent debt
			const balance = Math.abs(rawBalance);
			if (balance !== 0) {
				segments.push({ label: account.path, value: balance });
				total += balance;
			}
		}

		// Sort by value descending for consistent ordering
		segments.sort((a, b) => b.value - a.value);

		return { month, segments, total };
	});

	return {
		assets: {
			byAssetType: assetsByType,
			byAccount: assetsByAccount
		},
		liabilities: {
			byAccount: liabilitiesByAccount
		}
	};
}

// Tax Report Types and Functions

export interface TaxCategoryTotal {
	taxCategoryId: string | null;
	taxCategoryName: string;
	scheduleRef: string | null;
	description: string | null;
	accountType: AccountType;
	/** Business this total belongs to on a per-business schedule; null when not split */
	businessId: string | null;
	/** Total per the books (transactions) */
	total: number;
	/** Total per received tax documents mapped to this category, if any */
	documentTotal: number | null;
	documentLines: DocumentLineRef[];
	/**
	 * How much of `total` the documents replace. A document tied to an
	 * account replaces only that account's share; one with no account
	 * replaces the whole total.
	 */
	bookReplaced: number;
	/** Figures computed by module worksheets (home office), added to the reported total */
	worksheets: WorksheetRef[];
	computedTotal: number;
	/** The figure to report: the document total when one exists, else the book total, plus computed figures */
	reportedTotal: number;
	accounts: TaxAccountTotal[];
}

/** A worksheet's contribution to one category */
export interface WorksheetRef {
	worksheetId: string;
	name: string;
	amount: number;
	breakdown: WorksheetBreakdownRow[];
}

/** One run of a module worksheet, for one business on per-business modules */
export interface WorksheetOutput {
	worksheetId: string;
	moduleId: string;
	name: string;
	description: string | null;
	businessId: string | null;
	businessName: string | null;
	facts: Partial<Record<string, FactValue>>;
	lines: WorksheetLine[];
	breakdown: WorksheetBreakdownRow[];
}

export interface TaxAccountTotal {
	id: string;
	path: string;
	total: number;
	/**
	 * Signed amount of this account's transactions left out of `total`
	 * because their other side is a retirement account.
	 */
	excluded: number;
}

/** One transaction behind a tax report figure, signed as it affected the total. */
export interface TaxTransactionRow {
	id: string;
	date: Date;
	description: string;
	/** Positive adds to the account's figure, negative (a refund) reduces it */
	amount: number;
	otherAccount: { id: string; path: string } | null;
	status: string;
}

export interface TaxAccountTransactions {
	accountId: string;
	path: string;
	accountType: AccountType;
	rows: TaxTransactionRow[];
	total: number;
	/** Transactions with a retirement counterparty, excluded from `total` */
	excluded: { count: number; amount: number };
}

const RETIREMENT_ASSET_TYPES = new Set<string>(['ROTH_RETIREMENT', 'TAX_DEFERRED']);

interface TaxTransactionInput {
	id: string;
	date: Date;
	description: string;
	amount: number;
	status: string;
	mergedIntoId: string | null;
	debitAccount: { id: string; path: string; assetType: string | null } | null;
	creditAccount: { id: string; path: string; assetType: string | null } | null;
}

/**
 * Apply the tax report's rules to an account's transactions: skip merged
 * transactions, sign each amount by which side of the account it hit (so a
 * refund on an expense account counts negative), and set aside those whose
 * other side is a ROTH_RETIREMENT or TAX_DEFERRED asset account. The rows
 * returned sum to the account's figure on the report.
 */
export function taxTransactionRows(
	accountId: string,
	accountType: AccountType,
	transactions: TaxTransactionInput[]
): Pick<TaxAccountTransactions, 'rows' | 'total' | 'excluded'> {
	const rows: TaxTransactionRow[] = [];
	const excluded = { count: 0, amount: 0 };
	let total = 0;
	for (const tx of transactions) {
		if (tx.mergedIntoId !== null) continue;
		const isDebit = tx.debitAccount?.id === accountId;
		const isCredit = tx.creditAccount?.id === accountId;
		if (!isDebit && !isCredit) continue;
		const other = isDebit ? tx.creditAccount : tx.debitAccount;
		const normalSide = accountType === 'INCOME' ? isCredit : isDebit;
		const amount = normalSide ? tx.amount : -tx.amount;
		if (other && RETIREMENT_ASSET_TYPES.has(other.assetType ?? '')) {
			excluded.count += 1;
			excluded.amount += amount;
			continue;
		}
		total += amount;
		rows.push({
			id: tx.id,
			date: tx.date,
			description: tx.description,
			amount,
			otherAccount: other ? { id: other.id, path: other.path } : null,
			status: tx.status
		});
	}
	return { rows, total, excluded };
}

/**
 * The transactions behind one account's figure on the tax report for a year.
 */
export async function getTaxAccountTransactions(bookId: string, accountId: string, year: number): Promise<TaxAccountTransactions> {
	const account = await db.account.findUnique({ where: { id: accountId }, select: { id: true, bookId: true, path: true, type: true } });
	if (!account || account.bookId !== bookId) throw new Error('Account not found in this book');
	if (account.type !== 'INCOME' && account.type !== 'EXPENSE') throw new Error('Only income and expense accounts appear on the tax report');

	const transactions = await db.transaction.findMany({
		where: {
			OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }],
			date: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59, 999) }
		},
		select: {
			id: true,
			date: true,
			description: true,
			amount: true,
			status: true,
			mergedIntoId: true,
			debitAccount: { select: { id: true, path: true, assetType: true } },
			creditAccount: { select: { id: true, path: true, assetType: true } }
		},
		orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
	});

	const result = taxTransactionRows(
		accountId,
		account.type,
		transactions.map((t) => ({ ...t, amount: Number(t.amount) }))
	);
	return { accountId, path: account.path, accountType: account.type, ...result };
}

export interface ScheduleSection {
	/** Unique within the report: schedule plus business */
	key: string;
	schedule: string; // "Schedule C", "Schedule A", "Form 1120", etc.
	description: string; // Short description of the schedule
	/** Business this section is for, on per-business schedules when the book has businesses */
	businessId: string | null;
	businessName: string | null;
	/** True for a per-business schedule whose accounts have no business assigned */
	unassigned: boolean;
	incomeCategories: TaxCategoryTotal[];
	expenseCategories: TaxCategoryTotal[];
	totalIncome: number;
	totalExpenses: number;
	netAmount: number;
	/** True when any category in the section has a document figure */
	hasDocuments: boolean;
	reportedIncome: number;
	reportedExpenses: number;
	reportedNet: number;
}

export interface TaxReportData {
	year: number;
	dateRange: { from: Date; to: Date };
	// Dynamic schedule sections
	sections: ScheduleSection[];
	// Module worksheets that produced figures, with their math
	worksheets: WorksheetOutput[];
	// Non-deductible items (for reference)
	nonDeductible: {
		expenses: TaxCategoryTotal[];
		income: TaxCategoryTotal[];
	};
	// Summary
	uncategorizedExpenses: {
		id: string;
		path: string;
		total: number;
	}[];
	uncategorizedIncome: {
		id: string;
		path: string;
		total: number;
	}[];
	// Income earned inside retirement accounts, excluded from the totals above
	retirementIncomeExcluded: number;
	// Open items from the tax year questionnaire and expected documents
	openQuestions: number;
	missingDocuments: number;
	// Received document lines with a non-zero amount and no tax category, so
	// they appear nowhere above. Zero boxes are informational and skipped.
	unmappedDocumentLines: number;
}

// Expenses Report Types and Functions

export interface ExpenseCategoryNode {
	id: string;
	path: string;
	name: string; // Just the last segment
	total: number;
	children: ExpenseCategoryNode[];
}

export interface ExpensesReportData {
	dateRange: { from: Date; to: Date };
	totalExpenses: number;
	monthlyData: MonthlyStackedData[];
	categoryTree: ExpenseCategoryNode[];
}

/**
 * Get expenses report data for a given date range.
 * Groups expenses by top-level category with drill-down support.
 */
/**
 * Group per-account monthly totals by top-level category, one entry per month
 * with segments sorted by value descending. Months are sorted ascending.
 */
export function buildMonthlyData(
	monthlyTotals: { accountId: string; month: string; total: number }[],
	accountPaths: Map<string, string>
): MonthlyStackedData[] {
	const monthCategoryTotals = new Map<string, Map<string, number>>();
	const allMonths = new Set<string>();
	const allTopLevelCategories = new Set<string>();

	for (const row of monthlyTotals) {
		const path = accountPaths.get(row.accountId);
		if (!path) continue;

		// Top-level category is the first segment of the path
		const topLevel = path.split(':')[0];
		allMonths.add(row.month);
		allTopLevelCategories.add(topLevel);

		if (!monthCategoryTotals.has(row.month)) {
			monthCategoryTotals.set(row.month, new Map());
		}
		const categoryMap = monthCategoryTotals.get(row.month)!;
		categoryMap.set(topLevel, (categoryMap.get(topLevel) || 0) + Number(row.total));
	}

	const sortedMonths = Array.from(allMonths).sort();

	return sortedMonths.map(month => {
		const categoryMap = monthCategoryTotals.get(month) || new Map();
		const segments: StackedBarSegment[] = [];
		let total = 0;

		for (const category of allTopLevelCategories) {
			const value = categoryMap.get(category) || 0;
			if (value > 0) {
				segments.push({ label: category, value });
				total += value;
			}
		}

		segments.sort((a, b) => b.value - a.value);
		return { month, segments, total };
	});
}

/**
 * Build a category tree from a flat account list. Intermediate path segments
 * that aren't accounts become virtual nodes; totals roll up to ancestors and
 * each level is sorted by total descending.
 */
export function buildCategoryTree(
	accounts: { id: string; path: string }[],
	accountTotals: Map<string, number>
): ExpenseCategoryNode[] {
	const root: ExpenseCategoryNode[] = [];
	const nodeMap = new Map<string, ExpenseCategoryNode>();

	// Sort accounts by path for consistent ordering
	const sortedAccounts = [...accounts].sort((a, b) => a.path.localeCompare(b.path));

	for (const account of sortedAccounts) {
		const total = accountTotals.get(account.id) || 0;
		const parts = account.path.split(':');

		let currentPath = '';
		let parentChildren = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			currentPath = currentPath ? `${currentPath}:${part}` : part;
			const isLeaf = i === parts.length - 1;

			let node = nodeMap.get(currentPath);
			if (!node) {
				node = {
					id: isLeaf ? account.id : `virtual:${currentPath}`,
					path: currentPath,
					name: part,
					total: 0,
					children: []
				};
				nodeMap.set(currentPath, node);
				parentChildren.push(node);
			}

			// Add total to this node and all ancestors
			if (isLeaf) {
				node.total += total;
				let parentPath = parts.slice(0, i).join(':');
				while (parentPath) {
					const parentNode = nodeMap.get(parentPath);
					if (parentNode) {
						parentNode.total += total;
					}
					const parentParts = parentPath.split(':');
					parentParts.pop();
					parentPath = parentParts.join(':');
				}
			}

			parentChildren = node.children;
		}
	}

	// Sort each level by total descending
	function sortChildren(nodes: ExpenseCategoryNode[]) {
		nodes.sort((a, b) => b.total - a.total);
		for (const node of nodes) {
			sortChildren(node.children);
		}
	}
	sortChildren(root);

	return root;
}

export async function getExpensesReportData(
	bookId: string,
	from: Date,
	to: Date
): Promise<ExpensesReportData> {
	// Get all expense accounts
	const accounts = await db.account.findMany({
		where: { bookId, type: 'EXPENSE' },
		select: {
			id: true,
			path: true
		}
	});

	if (accounts.length === 0) {
		return {
			dateRange: { from, to },
			totalExpenses: 0,
			monthlyData: [],
			categoryTree: []
		};
	}

	// Get monthly totals per account for the date range
	// For expenses: money flows FROM asset TO expense (debit side)
	const monthlyTotals = await db.$queryRaw<
		{ accountId: string; month: string; total: number }[]
	>`
		SELECT
			"debitAccountId" as "accountId",
			TO_CHAR(date, 'YYYY-MM') as month,
			SUM(amount) as total
		FROM "Transaction"
		WHERE "debitAccountId" IN (${Prisma.join(accounts.map(a => a.id))})
			AND date >= ${from}
			AND date <= ${to}
			AND "merged_into_id" IS NULL
		GROUP BY "debitAccountId", TO_CHAR(date, 'YYYY-MM')
		ORDER BY month ASC
	`;

	const accountPathMap = new Map(accounts.map(a => [a.id, a.path]));
	const monthlyData = buildMonthlyData(monthlyTotals, accountPathMap);

	// Total per account for the entire period
	const accountTotals = new Map<string, number>();
	for (const row of monthlyTotals) {
		accountTotals.set(
			row.accountId,
			(accountTotals.get(row.accountId) || 0) + Number(row.total)
		);
	}

	const categoryTree = buildCategoryTree(accounts, accountTotals);
	const totalExpenses = categoryTree.reduce((sum, node) => sum + node.total, 0);

	return {
		dateRange: { from, to },
		totalExpenses,
		monthlyData,
		categoryTree
	};
}

/**
 * Get tax report data for a given year.
 * Aggregates income and expenses by tax category, with focus on Schedule C.
 */
export async function getTaxReportData(bookId: string, year: number): Promise<TaxReportData> {
	const startDate = new Date(year, 0, 1); // Jan 1
	const endDate = new Date(year, 11, 31, 23, 59, 59, 999); // Dec 31

	// Get all accounts with their tax categories
	const accounts = await db.account.findMany({
		where: {
			bookId,
			type: { in: ['INCOME', 'EXPENSE'] }
		},
		include: {
			taxCategory: true
		}
	});

	const incomeAccounts = accounts.filter((a) => a.type === 'INCOME');
	const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE');

	const [documentTotals, yearStatus, allCategories, unmappedDocumentLines, enabledModules] = await Promise.all([
		getDocumentTotalsByCategory(bookId, year),
		getTaxYearStatus(bookId, year),
		db.taxCategory.findMany({ where: { bookId } }),
		db.taxDocumentLine.count({
			where: { taxCategoryId: null, amount: { not: 0 }, document: { bookId, year, status: 'RECEIVED' } }
		}),
		getEnabledModules(bookId)
	]);

	// Transaction totals per account for the year, split by counterparty so a
	// document tied to one asset account can replace just that account's share.
	const counterpartyTotals = await getTaxAccountTotals(bookId, year);

	// Income credited from retirement accounts, reported separately so the
	// exclusion above is visible rather than silent.
	const retirementRows = await db.$queryRaw<{ total: number }[]>`
		SELECT COALESCE(SUM(t.amount), 0) as total
		FROM "Transaction" t
		JOIN "Account" income ON income.id = t."creditAccountId"
		JOIN "Account" other ON other.id = t."debitAccountId"
		WHERE income."bookId" = ${bookId}
		AND income.type = 'INCOME'
		AND other."assetType"::text IN ('ROTH_RETIREMENT', 'TAX_DEFERRED')
		AND t.date >= ${startDate}
		AND t.date <= ${endDate}
		AND t."merged_into_id" IS NULL
	`;
	const retirementIncomeExcluded = Number(retirementRows[0]?.total ?? 0);

	// Per-account totals and the counterparty rows behind them
	const totalMap = new Map<string, number>();
	const excludedMap = new Map<string, number>();
	const rowsByAccount = new Map<string, OverlayRow[]>();
	for (const row of counterpartyTotals) {
		totalMap.set(row.accountId, (totalMap.get(row.accountId) ?? 0) + row.total);
		excludedMap.set(row.accountId, (excludedMap.get(row.accountId) ?? 0) + row.excluded);
		const rows = rowsByAccount.get(row.accountId) ?? [];
		rows.push({ accountId: row.accountId, counterpartyId: row.counterpartyId, total: row.total });
		rowsByAccount.set(row.accountId, rows);
	}

	// Categories that should be excluded from deductible totals
	const nonDeductibleCategories = new Set(['Not Deductible', 'Tax Exempt']);

	// Per-business schedules (Schedule C) are split by the business each
	// account belongs to once the book has businesses. Scope is the business
	// id, '' for accounts on such a schedule with no business, or null when
	// the schedule isn't split.
	const businesses = await db.business.findMany({ where: { bookId }, orderBy: { createdAt: 'asc' } });
	const businessNames = new Map(businesses.map((b) => [b.id, b.name]));
	const splitSchedules = businesses.length > 0 ? perBusinessSchedules() : new Set<string>();
	const scopeFor = (scheduleRef: string | null, businessId: string | null): string | null => {
		const schedule = scheduleOf(scheduleRef);
		return schedule !== null && splitSchedules.has(schedule) ? (businessId ?? '') : null;
	};
	const scopeOfLine = (line: DocumentLineRef) => line.businessId ?? '';

	// Document figures for a category within a scope
	const documentsFor = (taxCategoryId: string, scope: string | null): { total: number; lines: DocumentLineRef[] } | null => {
		const docs = documentTotals.get(taxCategoryId);
		if (!docs) return null;
		const lines = scope === null ? docs.lines : docs.lines.filter((l) => scopeOfLine(l) === scope);
		if (lines.length === 0) return null;
		return { total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
	};

	// Group by tax category (and business on split schedules)
	function groupByTaxCategory(
		accountList: typeof accounts,
		accountType: AccountType
	): {
		deductible: TaxCategoryTotal[];
		nonDeductible: TaxCategoryTotal[];
		uncategorized: { id: string; path: string; total: number }[];
	} {
		const categoryMap = new Map<string, TaxCategoryTotal>();
		const uncategorized: { id: string; path: string; total: number }[] = [];

		const entryFor = (
			category: { id: string; name: string; scheduleRef: string | null; description: string | null },
			scope: string | null
		): TaxCategoryTotal => {
			const key = `${scope ?? '*'}|${category.id}`;
			let entry = categoryMap.get(key);
			if (!entry) {
				entry = {
					taxCategoryId: category.id,
					taxCategoryName: category.name,
					scheduleRef: category.scheduleRef,
					description: category.description,
					accountType,
					businessId: scope === null ? null : scope || null,
					total: 0,
					documentTotal: null,
					documentLines: [],
					bookReplaced: 0,
					worksheets: [],
					computedTotal: 0,
					reportedTotal: 0,
					accounts: []
				};
				categoryMap.set(key, entry);
			}
			return entry;
		};

		for (const account of accountList) {
			const total = totalMap.get(account.id) ?? 0;
			const excluded = excludedMap.get(account.id) ?? 0;
			if (total === 0 && excluded === 0) continue;

			if (!account.taxCategoryId || !account.taxCategory) {
				if (total !== 0) uncategorized.push({ id: account.id, path: account.path, total });
				continue;
			}

			const cat = entryFor(account.taxCategory, scopeFor(account.taxCategory.scheduleRef, account.businessId));
			cat.total += total;
			cat.reportedTotal = cat.total;
			cat.accounts.push({ id: account.id, path: account.path, total, excluded });
		}

		// Categories with document figures but no account activity still belong
		// in the report: a 1099-B's capital gains have no book transactions.
		const accountCategoryIds = new Set(accountList.map((a) => a.taxCategoryId));
		for (const category of allCategories) {
			const docs = documentTotals.get(category.id);
			if (!docs || accountCategoryIds.has(category.id)) continue;
			if (classifyDocumentOnlyCategory(category.name, category.scheduleRef) !== accountType) continue;
			const split = scopeFor(category.scheduleRef, null) !== null;
			const scopes = split ? new Set(docs.lines.map(scopeOfLine)) : new Set<string | null>([null]);
			for (const scope of scopes) entryFor(category, scope);
		}

		// Overlay document figures
		for (const [key, cat] of categoryMap) {
			const scope = key.startsWith('*|') ? null : key.slice(0, key.indexOf('|'));
			const docs = cat.taxCategoryId ? documentsFor(cat.taxCategoryId, scope) : null;
			if (docs) {
				const rows = cat.accounts.flatMap((a) => rowsByAccount.get(a.id) ?? []);
				const overlay = overlayDocumentFigures(accountType, rows, docs.lines);
				cat.documentTotal = docs.total;
				cat.documentLines = docs.lines;
				cat.bookReplaced = overlay.bookReplaced;
				cat.reportedTotal = overlay.reportedTotal;
			}
		}

		// Separate deductible from non-deductible categories
		const allCategoryTotals = Array.from(categoryMap.values());
		const deductible = allCategoryTotals.filter((c) => !nonDeductibleCategories.has(c.taxCategoryName));
		const nonDeductibleItems = allCategoryTotals.filter((c) => nonDeductibleCategories.has(c.taxCategoryName));

		sortCategories(deductible);
		sortCategories(nonDeductibleItems);

		// Sort accounts within each category by total descending
		for (const cat of [...deductible, ...nonDeductibleItems]) {
			cat.accounts.sort((a, b) => b.total - a.total);
		}

		return { deductible, nonDeductible: nonDeductibleItems, uncategorized };
	}

	// Sort categories by schedule reference for logical ordering
	const sortCategories = (cats: TaxCategoryTotal[]) =>
		cats.sort((a, b) => {
			if (!a.scheduleRef && !b.scheduleRef) return a.taxCategoryName.localeCompare(b.taxCategoryName);
			if (!a.scheduleRef) return 1;
			if (!b.scheduleRef) return -1;
			return a.scheduleRef.localeCompare(b.scheduleRef);
		});

	const incomeGrouped = groupByTaxCategory(incomeAccounts, 'INCOME');
	const expenseGrouped = groupByTaxCategory(expenseAccounts, 'EXPENSE');

	// Schedule descriptions
	const scheduleDescriptions: Record<string, string> = {
		'Schedule A': 'Itemized Deductions',
		'Schedule B': 'Interest and Dividends',
		'Schedule C': 'Profit or Loss From Business (Sole Proprietorship)',
		'Schedule D': 'Capital Gains and Losses',
		'Schedule E': 'Supplemental Income and Loss',
		'Schedule SE': 'Self-Employment Tax',
		'Schedule 1': 'Additional Income and Adjustments',
		'Schedule CA': 'California Adjustments',
		'Form 1120': 'U.S. Corporation Income Tax Return',
		'IT-201': 'New York State Resident Income Tax',
		'NJ-1040': 'New Jersey Resident Income Tax',
		'CA 540': 'California Resident Income Tax'
	};

	// Group deductible categories by schedule and business
	const scheduleMap = new Map<string, { schedule: string; scope: string | null; income: TaxCategoryTotal[]; expenses: TaxCategoryTotal[] }>();
	const bucketFor = (cat: TaxCategoryTotal) => {
		const schedule = scheduleOf(cat.scheduleRef) ?? 'Other';
		const scope = scopeFor(cat.scheduleRef, cat.businessId);
		const key = `${schedule}|${scope ?? '*'}`;
		let bucket = scheduleMap.get(key);
		if (!bucket) {
			bucket = { schedule, scope, income: [], expenses: [] };
			scheduleMap.set(key, bucket);
		}
		return bucket;
	};
	for (const cat of incomeGrouped.deductible) bucketFor(cat).income.push(cat);
	for (const cat of expenseGrouped.deductible) bucketFor(cat).expenses.push(cat);

	// Sort sections by schedule (Schedule C first for business users), then
	// by business in creation order with unassigned accounts last.
	const scheduleOrder = ['Schedule C', 'Schedule A', 'Schedule B', 'Schedule D', 'Schedule E', 'Schedule 1', 'Form 1120', 'IT-201', 'NJ-1040'];
	const businessOrder = (scope: string | null) => {
		if (scope === null) return -1;
		if (scope === '') return businesses.length;
		return businesses.findIndex((b) => b.id === scope);
	};
	const sortedBuckets = Array.from(scheduleMap.values()).sort((a, b) => {
		const aIdx = scheduleOrder.indexOf(a.schedule);
		const bIdx = scheduleOrder.indexOf(b.schedule);
		if (aIdx !== bIdx) {
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		}
		if (a.schedule !== b.schedule) return a.schedule.localeCompare(b.schedule);
		return businessOrder(a.scope) - businessOrder(b.scope);
	});

	const sections: ScheduleSection[] = sortedBuckets.map((data) => {
		const { schedule, scope } = data;
		const totalIncome = data.income.reduce((sum, c) => sum + c.total, 0);
		const totalExpenses = data.expenses.reduce((sum, c) => sum + c.total, 0);
		const reportedIncome = data.income.reduce((sum, c) => sum + c.reportedTotal, 0);
		const reportedExpenses = data.expenses.reduce((sum, c) => sum + c.reportedTotal, 0);
		const businessId = scope ? scope : null;
		return {
			key: scope === null ? schedule : `${schedule}|${scope}`,
			schedule,
			description: scheduleDescriptions[schedule] ?? '',
			businessId,
			businessName: businessId ? (businessNames.get(businessId) ?? null) : null,
			unassigned: scope === '',
			incomeCategories: data.income,
			expenseCategories: data.expenses,
			totalIncome,
			totalExpenses,
			netAmount: totalIncome - totalExpenses,
			hasDocuments: [...data.income, ...data.expenses].some((c) => c.documentTotal !== null),
			reportedIncome,
			reportedExpenses,
			reportedNet: reportedIncome - reportedExpenses
		};
	});

	// Module worksheets: computed figures (a home office deduction from square
	// footage) land on their category in the section they belong to, per
	// business for per-business modules.
	const worksheets: WorksheetOutput[] = [];
	const accountFigures = accounts.map((a) => ({ id: a.id, path: a.path, type: a.type as 'INCOME' | 'EXPENSE', total: totalMap.get(a.id) ?? 0 }));
	const sectionByKey = new Map(sections.map((s) => [s.key, s]));
	const refreshSection = (section: ScheduleSection) => {
		section.reportedIncome = section.incomeCategories.reduce((sum, c) => sum + c.reportedTotal, 0);
		section.reportedExpenses = section.expenseCategories.reduce((sum, c) => sum + c.reportedTotal, 0);
		section.reportedNet = section.reportedIncome - section.reportedExpenses;
	};
	for (const status of yearStatus.modules) {
		const module = enabledModules.find((e) => e.moduleId === status.moduleId)?.module;
		if (!module?.worksheets?.length) continue;
		const facts: Partial<Record<string, FactValue>> = {};
		for (const q of status.questions) if (q.answered && q.answer !== null) facts[q.key] = q.answer;

		for (const worksheet of module.worksheets) {
			const inputs: Partial<Record<string, FactValue>> = {};
			for (const key of worksheet.facts) if (facts[key] !== undefined) inputs[key] = facts[key];

			// A dry run tells us which category, and so which section, the
			// worksheet feeds; the real run then gets that section's figures
			// for its gross income limit.
			const probe = worksheet.compute({ facts: inputs, accounts: accountFigures, section: { income: 0, expenses: 0 } });
			if (!probe || probe.lines.length === 0) continue;
			const category = allCategories.find((c) => c.name === probe.lines[0].category);
			const schedule = scheduleOf(category?.scheduleRef ?? null);
			if (!category || !schedule) continue;
			const sectionKey = status.businessId ? `${schedule}|${status.businessId}` : schedule;
			const section = sectionByKey.get(sectionKey);
			if (!section) continue;

			const own = [...section.incomeCategories, ...section.expenseCategories].find((c) => c.taxCategoryId === category.id);
			const result = worksheet.compute({
				facts: inputs,
				accounts: accountFigures,
				section: { income: section.reportedIncome, expenses: section.reportedExpenses - (own?.reportedTotal ?? 0) }
			});
			if (!result) continue;

			for (const line of result.lines) {
				const lineCategory = allCategories.find((c) => c.name === line.category);
				if (!lineCategory) continue;
				let entry = [...section.incomeCategories, ...section.expenseCategories].find((c) => c.taxCategoryId === lineCategory.id);
				if (!entry) {
					entry = {
						taxCategoryId: lineCategory.id,
						taxCategoryName: lineCategory.name,
						scheduleRef: lineCategory.scheduleRef,
						description: lineCategory.description,
						accountType: 'EXPENSE',
						businessId: section.businessId,
						total: 0,
						documentTotal: null,
						documentLines: [],
						bookReplaced: 0,
						worksheets: [],
						computedTotal: 0,
						reportedTotal: 0,
						accounts: []
					};
					section.expenseCategories.push(entry);
					sortCategories(section.expenseCategories);
				}
				entry.worksheets.push({ worksheetId: worksheet.id, name: worksheet.name, amount: line.amount, breakdown: result.breakdown });
				entry.computedTotal += line.amount;
				entry.reportedTotal = (entry.documentTotal ?? entry.total) + entry.computedTotal;
			}
			refreshSection(section);

			worksheets.push({
				worksheetId: worksheet.id,
				moduleId: module.id,
				name: worksheet.name,
				description: worksheet.description ?? null,
				businessId: status.businessId,
				businessName: status.businessName,
				facts: inputs,
				lines: result.lines,
				breakdown: result.breakdown
			});
		}
	}

	return {
		year,
		dateRange: { from: startDate, to: endDate },
		sections,
		worksheets,
		nonDeductible: {
			expenses: expenseGrouped.nonDeductible,
			income: incomeGrouped.nonDeductible
		},
		uncategorizedExpenses: expenseGrouped.uncategorized.sort((a, b) => b.total - a.total),
		uncategorizedIncome: incomeGrouped.uncategorized.sort((a, b) => b.total - a.total),
		retirementIncomeExcluded,
		openQuestions: yearStatus.openQuestions,
		missingDocuments: yearStatus.missingDocuments,
		unmappedDocumentLines
	};
}

/**
 * A category that only has document figures has no accounts to tell us
 * whether it is income or a deduction, so guess from its name and line.
 */
function classifyDocumentOnlyCategory(name: string, scheduleRef: string | null): AccountType {
	const text = `${name} ${scheduleRef ?? ''}`;
	if (/deduct|expense|interest paid|mortgage|real estate tax|property tax|state & local|charitable|medical|contribution|premium|withheld|estimated|insurance|tuition/i.test(text)) {
		return 'EXPENSE';
	}
	return 'INCOME';
}
