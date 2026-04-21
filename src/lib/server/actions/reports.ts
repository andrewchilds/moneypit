import { db } from '../db';
import { Prisma } from '@prisma/client';
import type { AssetType, AccountType } from '@prisma/client';

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
	total: number;
	accounts: {
		id: string;
		path: string;
		total: number;
	}[];
}

export interface ScheduleSection {
	schedule: string; // "Schedule C", "Schedule A", "Form 1120", etc.
	description: string; // Short description of the schedule
	incomeCategories: TaxCategoryTotal[];
	expenseCategories: TaxCategoryTotal[];
	totalIncome: number;
	totalExpenses: number;
	netAmount: number;
}

export interface TaxReportData {
	year: number;
	dateRange: { from: Date; to: Date };
	// Dynamic schedule sections
	sections: ScheduleSection[];
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

	// Build accountId -> path map
	const accountPathMap = new Map(accounts.map(a => [a.id, a.path]));

	// Get all unique months in the range
	const allMonths = new Set<string>();
	for (const row of monthlyTotals) {
		allMonths.add(row.month);
	}
	const sortedMonths = Array.from(allMonths).sort();

	// Build monthly data grouped by top-level category
	// First, collect totals per top-level category per month
	const monthCategoryTotals = new Map<string, Map<string, number>>();

	for (const row of monthlyTotals) {
		const path = accountPathMap.get(row.accountId);
		if (!path) continue;

		// Get top-level category (first segment of path)
		const topLevel = path.split(':')[0];
		const total = Number(row.total);

		if (!monthCategoryTotals.has(row.month)) {
			monthCategoryTotals.set(row.month, new Map());
		}
		const categoryMap = monthCategoryTotals.get(row.month)!;
		categoryMap.set(topLevel, (categoryMap.get(topLevel) || 0) + total);
	}

	// Collect all top-level categories
	const allTopLevelCategories = new Set<string>();
	for (const categoryMap of monthCategoryTotals.values()) {
		for (const category of categoryMap.keys()) {
			allTopLevelCategories.add(category);
		}
	}

	// Build monthly stacked data
	const monthlyData: MonthlyStackedData[] = sortedMonths.map(month => {
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

		// Sort segments by value descending
		segments.sort((a, b) => b.value - a.value);

		return { month, segments, total };
	});

	// Build category tree with totals
	// First, calculate total per account for the entire period
	const accountTotals = new Map<string, number>();
	for (const row of monthlyTotals) {
		accountTotals.set(
			row.accountId,
			(accountTotals.get(row.accountId) || 0) + Number(row.total)
		);
	}

	// Build tree structure
	function buildTree(): ExpenseCategoryNode[] {
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
					// Propagate total up to parents
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

	const categoryTree = buildTree();
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

	// Get transaction totals per account for the year
	// For income: money flows FROM income TO asset (credit side is income)
	// For expense: money flows FROM asset TO expense (debit side is expense)
	const accountTotals = await db.$queryRaw<{ accountId: string; total: number }[]>`
		SELECT
			a.id as "accountId",
			COALESCE(
				CASE
					WHEN a.type = 'INCOME' THEN (
						SELECT SUM(t.amount)
						FROM "Transaction" t
						WHERE t."creditAccountId" = a.id
						AND t.date >= ${startDate}
						AND t.date <= ${endDate}
						AND t."merged_into_id" IS NULL
					)
					WHEN a.type = 'EXPENSE' THEN (
						SELECT SUM(t.amount)
						FROM "Transaction" t
						WHERE t."debitAccountId" = a.id
						AND t.date >= ${startDate}
						AND t.date <= ${endDate}
						AND t."merged_into_id" IS NULL
					)
				END,
				0
			) as total
		FROM "Account" a
		WHERE a.type IN ('INCOME', 'EXPENSE')
	`;

	// Build a map of account id -> total
	const totalMap = new Map<string, number>();
	for (const row of accountTotals) {
		totalMap.set(row.accountId, Number(row.total));
	}

	// Categories that should be excluded from deductible totals
	const nonDeductibleCategories = new Set(['Not Deductible', 'Tax Exempt']);

	// Group by tax category
	function groupByTaxCategory(
		accountList: typeof accounts,
		accountType: AccountType
	): {
		deductible: TaxCategoryTotal[];
		nonDeductible: TaxCategoryTotal[];
		uncategorized: { id: string; path: string; total: number }[];
	} {
		const categoryMap = new Map<string | null, TaxCategoryTotal>();
		const uncategorized: { id: string; path: string; total: number }[] = [];

		for (const account of accountList) {
			const total = totalMap.get(account.id) ?? 0;
			if (total === 0) continue;

			if (!account.taxCategoryId) {
				uncategorized.push({ id: account.id, path: account.path, total });
				continue;
			}

			const key = account.taxCategoryId;
			if (!categoryMap.has(key)) {
				categoryMap.set(key, {
					taxCategoryId: account.taxCategoryId,
					taxCategoryName: account.taxCategory?.name ?? 'Unknown',
					scheduleRef: account.taxCategory?.scheduleRef ?? null,
					description: account.taxCategory?.description ?? null,
					accountType,
					total: 0,
					accounts: []
				});
			}

			const cat = categoryMap.get(key)!;
			cat.total += total;
			cat.accounts.push({ id: account.id, path: account.path, total });
		}

		// Separate deductible from non-deductible categories
		const allCategories = Array.from(categoryMap.values());
		const deductible = allCategories.filter((c) => !nonDeductibleCategories.has(c.taxCategoryName));
		const nonDeductibleItems = allCategories.filter((c) => nonDeductibleCategories.has(c.taxCategoryName));

		// Sort categories by schedule reference for logical ordering
		const sortCategories = (cats: TaxCategoryTotal[]) =>
			cats.sort((a, b) => {
				if (!a.scheduleRef && !b.scheduleRef) return a.taxCategoryName.localeCompare(b.taxCategoryName);
				if (!a.scheduleRef) return 1;
				if (!b.scheduleRef) return -1;
				return a.scheduleRef.localeCompare(b.scheduleRef);
			});

		sortCategories(deductible);
		sortCategories(nonDeductibleItems);

		// Sort accounts within each category by total descending
		for (const cat of [...deductible, ...nonDeductibleItems]) {
			cat.accounts.sort((a, b) => b.total - a.total);
		}

		return { deductible, nonDeductible: nonDeductibleItems, uncategorized };
	}

	const incomeGrouped = groupByTaxCategory(incomeAccounts, 'INCOME');
	const expenseGrouped = groupByTaxCategory(expenseAccounts, 'EXPENSE');

	// Extract schedule name from scheduleRef (e.g., "Schedule C Line 8" -> "Schedule C")
	function extractSchedule(scheduleRef: string | null): string | null {
		if (!scheduleRef) return null;
		// Match patterns like "Schedule C", "Schedule A", "Form 1120", "IT-201", "NJ-1040", "CA 540", "Schedule CA"
		const match = scheduleRef.match(/^(Schedule [A-Z]{1,2}|Form \d+|[A-Z]{2}-?\d+|CA \d+)/);
		return match ? match[1] : scheduleRef.split(' ')[0];
	}

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

	// Group deductible categories by schedule
	const scheduleMap = new Map<string, {
		income: TaxCategoryTotal[];
		expenses: TaxCategoryTotal[];
	}>();

	for (const cat of incomeGrouped.deductible) {
		const schedule = extractSchedule(cat.scheduleRef) ?? 'Other';
		if (!scheduleMap.has(schedule)) {
			scheduleMap.set(schedule, { income: [], expenses: [] });
		}
		scheduleMap.get(schedule)!.income.push(cat);
	}

	for (const cat of expenseGrouped.deductible) {
		const schedule = extractSchedule(cat.scheduleRef) ?? 'Other';
		if (!scheduleMap.has(schedule)) {
			scheduleMap.set(schedule, { income: [], expenses: [] });
		}
		scheduleMap.get(schedule)!.expenses.push(cat);
	}

	// Build sections array, sorted by schedule name (Schedule C first for business users)
	const scheduleOrder = ['Schedule C', 'Schedule A', 'Schedule B', 'Schedule D', 'Schedule E', 'Schedule 1', 'Form 1120', 'IT-201', 'NJ-1040'];
	const sortedSchedules = Array.from(scheduleMap.keys()).sort((a, b) => {
		const aIdx = scheduleOrder.indexOf(a);
		const bIdx = scheduleOrder.indexOf(b);
		if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
		if (aIdx === -1) return 1;
		if (bIdx === -1) return -1;
		return aIdx - bIdx;
	});

	const sections: ScheduleSection[] = sortedSchedules.map((schedule) => {
		const data = scheduleMap.get(schedule)!;
		const totalIncome = data.income.reduce((sum, c) => sum + c.total, 0);
		const totalExpenses = data.expenses.reduce((sum, c) => sum + c.total, 0);
		return {
			schedule,
			description: scheduleDescriptions[schedule] ?? '',
			incomeCategories: data.income,
			expenseCategories: data.expenses,
			totalIncome,
			totalExpenses,
			netAmount: totalIncome - totalExpenses
		};
	});

	return {
		year,
		dateRange: { from: startDate, to: endDate },
		sections,
		nonDeductible: {
			expenses: expenseGrouped.nonDeductible,
			income: incomeGrouped.nonDeductible
		},
		uncategorizedExpenses: expenseGrouped.uncategorized.sort((a, b) => b.total - a.total),
		uncategorizedIncome: incomeGrouped.uncategorized.sort((a, b) => b.total - a.total)
	};
}
