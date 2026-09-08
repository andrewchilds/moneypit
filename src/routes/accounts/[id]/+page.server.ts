import { parseLocalDate } from '$lib/utils/date';
import { getAccount, updateAccount, deleteAccount, listAccounts } from '$lib/server/actions/accounts';
import { listTransactionsWithBalance, categorizeTransactions, countTransactionsForAccount } from '$lib/server/actions/transactions';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import { listBusinesses } from '$lib/server/actions/businesses';
import { listRulesForAccount, createRule, updateRule, deleteRule } from '$lib/server/actions/rules';
import {
	listBalanceRecords,
	createBalanceRecord,
	deleteBalanceRecord,
	getCalculatedBalanceAsOf,
	getCurrentBalance,
	getBalanceForDateRange,
	getMonthlyActivity
} from '$lib/server/actions/balanceRecords';
import type { AssetType } from '@prisma/client';
import { error, fail, redirect } from '@sveltejs/kit';

export type DateRangePreset = 'all' | 'ytd' | 'last-6-months' | 'last-12-months' | 'last-18-months' | 'custom';

function getDateRange(preset: DateRangePreset, year?: number): { from: Date | undefined; to: Date | undefined } {
	const now = new Date();
	const currentYear = now.getFullYear();

	switch (preset) {
		case 'all':
			return { from: undefined, to: undefined };
		case 'ytd':
			return {
				from: new Date(currentYear, 0, 1),
				to: now
			};
		case 'last-6-months': {
			const sixMonthsAgo = new Date(now);
			sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
			sixMonthsAgo.setDate(1);
			return { from: sixMonthsAgo, to: now };
		}
		case 'last-12-months': {
			const twelveMonthsAgo = new Date(now);
			twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
			twelveMonthsAgo.setDate(1);
			return { from: twelveMonthsAgo, to: now };
		}
		case 'last-18-months': {
			const eighteenMonthsAgo = new Date(now);
			eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
			eighteenMonthsAgo.setDate(1);
			return { from: eighteenMonthsAgo, to: now };
		}
		case 'custom':
			if (year) {
				return {
					from: new Date(year, 0, 1),
					to: new Date(year, 11, 31, 23, 59, 59, 999)
				};
			}
			return { from: undefined, to: undefined };
		default:
			return { from: undefined, to: undefined };
	}
}

export async function load({ params, url, locals }) {
	const { bookId } = locals;
	const account = await getAccount(params.id);

	if (!account) {
		throw error(404, 'Account not found');
	}

	// Parse date range from URL
	const rangeParam = url.searchParams.get('range') as DateRangePreset | null;
	const yearParam = url.searchParams.get('year');
	const currentRange = rangeParam || 'last-18-months';
	const year = yearParam ? parseInt(yearParam, 10) : undefined;
	const { from, to } = getDateRange(currentRange, year);

	const [transactionResult, taxCategories, balanceRecords, currentBalance, monthlyActivity, accounts, transactionCount, rules, businesses] = await Promise.all([
		listTransactionsWithBalance(params.id, { limit: 50, from, to }),
		listTaxCategories(bookId),
		listBalanceRecords(params.id),
		getCurrentBalance(params.id),
		getMonthlyActivity(params.id, { from, to }),
		listAccounts(bookId),
		countTransactionsForAccount(params.id),
		listRulesForAccount(params.id),
		listBusinesses(bookId)
	]);

	// Calculate displayed balance - either filtered range total or current balance
	const displayedBalance = from && to
		? await getBalanceForDateRange(params.id, from, to)
		: currentBalance;

	const { transactions, nextCursor } = transactionResult;

	// Calculate balance as of each record date for comparison
	const balanceRecordsWithCalculated = await Promise.all(
		balanceRecords.map(async (record) => {
			const calculated = await getCalculatedBalanceAsOf(params.id, record.date);
			return {
				...record,
				balance: Number(record.balance),
				date: record.date.toISOString(),
				calculatedBalance: calculated
			};
		})
	);

	// Transactions already have balance calculated via SQL window function
	const transactionsWithBalance = transactions.map((t) => ({
		...t,
		amount: Number(t.amount),
		date: t.date.toISOString()
	}));

	return {
		account: {
			...account,
			openingBalance: account.openingBalance != null ? Number(account.openingBalance) : null
		},
		currentBalance: displayedBalance,
		transactions: transactionsWithBalance,
		nextCursor,
		taxCategories,
		businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
		balanceRecords: balanceRecordsWithCalculated,
		monthlyActivity,
		accounts: accounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		})),
		transactionCount,
		rules: rules.map((r) => ({
			...r,
			amountMin: r.amountMin != null ? Number(r.amountMin) : null,
			amountMax: r.amountMax != null ? Number(r.amountMax) : null,
			amountExact: r.amountExact != null ? Number(r.amountExact) : null
		})),
		currentRange,
		currentYear: year ?? null,
		dateFilter: {
			from: from?.toISOString() ?? null,
			to: to?.toISOString() ?? null
		}
	};
}

export const actions = {
	update: async ({ params, request }) => {
		const data = await request.formData();
		const type = data.get('type') as string;
		const path = data.get('path') as string;
		const taxCategoryId = data.get('taxCategoryId') as string | null;
		const openingBalanceStr = data.get('openingBalance') as string | null;
		const last4Str = data.get('last4') as string | null;
		const assetTypeStr = data.get('assetType') as string | null;
		const businessIdStr = data.get('businessId') as string | null;

		const openingBalance =
			openingBalanceStr === '' ? null : openingBalanceStr ? parseFloat(openingBalanceStr) : undefined;
		const last4 = last4Str === '' ? null : last4Str ?? undefined;
		const assetType = type === 'ASSET' && assetTypeStr ? (assetTypeStr as AssetType) : null;

		try {
			await updateAccount(params.id, {
				type: type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE',
				path: path?.trim() || undefined,
				taxCategoryId: taxCategoryId || null,
				...(businessIdStr !== null && { businessId: businessIdStr || null }),
				...(openingBalance !== undefined && { openingBalance }),
				...(last4 !== undefined && { last4 }),
				...(type === 'ASSET' && { assetType })
			});
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	delete: async ({ params }) => {
		try {
			await deleteAccount(params.id);
			throw redirect(303, '/accounts');
		} catch (e) {
			if ((e as { status?: number }).status === 303) throw e;
			return fail(400, { error: (e as Error).message });
		}
	},

	addBalanceRecord: async ({ params, request }) => {
		const data = await request.formData();
		const date = data.get('date') as string;
		const balance = data.get('balance') as string;

		if (!date || !balance) {
			return fail(400, { error: 'Date and balance are required' });
		}

		try {
			await createBalanceRecord(
				params.id,
				parseLocalDate(date),
				parseFloat(balance)
			);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	deleteBalanceRecord: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;

		if (!id) {
			return fail(400, { error: 'Balance record ID is required' });
		}

		try {
			await deleteBalanceRecord(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	categorize: async ({ request }) => {
		const data = await request.formData();
		const ids = data.getAll('ids') as string[];
		const accountId = data.get('accountId') as string;
		const side = data.get('side') as 'debit' | 'credit';

		if (ids.length === 0 || !accountId || !side) {
			return fail(400, { error: 'Missing required fields' });
		}

		try {
			const result = await categorizeTransactions(ids, accountId, side);
			return { success: true, updated: result.updated };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	createRule: async ({ params, request, locals }) => {
		const { bookId } = locals;
		const data = await request.formData();
		const pattern = data.get('pattern') as string;
		const field = data.get('field') as string;
		const isRegex = data.get('isRegex') === 'true';
		const priority = parseInt(data.get('priority') as string) || 0;
		const amountMin = data.get('amountMin') as string;
		const amountMax = data.get('amountMax') as string;
		const amountExact = data.get('amountExact') as string;

		if (!pattern?.trim()) {
			return fail(400, { error: 'Pattern is required' });
		}

		try {
			await createRule(bookId, pattern.trim(), params.id, {
				field: field || 'description',
				isRegex,
				priority,
				amountMin: amountMin ? parseFloat(amountMin) : undefined,
				amountMax: amountMax ? parseFloat(amountMax) : undefined,
				amountExact: amountExact ? parseFloat(amountExact) : undefined
			});
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	updateRule: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const pattern = data.get('pattern') as string;
		const field = data.get('field') as string;
		const isRegex = data.get('isRegex') === 'true';
		const priority = parseInt(data.get('priority') as string) || 0;
		const amountMin = data.get('amountMin') as string;
		const amountMax = data.get('amountMax') as string;
		const amountExact = data.get('amountExact') as string;

		if (!id) {
			return fail(400, { error: 'Rule ID is required' });
		}

		if (!pattern?.trim()) {
			return fail(400, { error: 'Pattern is required' });
		}

		try {
			await updateRule(id, {
				pattern: pattern.trim(),
				field: field || 'description',
				isRegex,
				priority,
				amountMin: amountMin ? parseFloat(amountMin) : null,
				amountMax: amountMax ? parseFloat(amountMax) : null,
				amountExact: amountExact ? parseFloat(amountExact) : null
			});
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	deleteRule: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;

		if (!id) {
			return fail(400, { error: 'Rule ID is required' });
		}

		try {
			await deleteRule(id);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
