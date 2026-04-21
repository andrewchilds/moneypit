import {
	listTransactionsPaginated,
	categorizeTransactions,
	flipTransactionAccounts,
	type SortColumn,
	type SortOrder
} from '$lib/server/actions/transactions';
import { listAccounts } from '$lib/server/actions/accounts';
import { fail } from '@sveltejs/kit';
import type { TransactionStatus } from '@prisma/client';

const validSortColumns: SortColumn[] = ['date', 'amount', 'description'];
const validSortOrders: SortOrder[] = ['asc', 'desc'];

export async function load({ url, locals }) {
	const { bookId } = locals;
	const accountParam = url.searchParams.get('account') ?? undefined;
	const uncategorized = accountParam === 'uncategorized';
	const accountId = uncategorized ? undefined : accountParam;
	const status = (url.searchParams.get('status') as TransactionStatus) ?? undefined;
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const search = url.searchParams.get('search') ?? undefined;
	const amountMinParam = url.searchParams.get('amountMin');
	const amountMaxParam = url.searchParams.get('amountMax');
	const amountMin = amountMinParam ? parseFloat(amountMinParam) : undefined;
	const amountMax = amountMaxParam ? parseFloat(amountMaxParam) : undefined;
	const limit = parseInt(url.searchParams.get('limit') ?? '100');

	const sortByParam = url.searchParams.get('sort');
	const sortOrderParam = url.searchParams.get('order');
	const sortBy = validSortColumns.includes(sortByParam as SortColumn)
		? (sortByParam as SortColumn)
		: 'date';
	const sortOrder = validSortOrders.includes(sortOrderParam as SortOrder)
		? (sortOrderParam as SortOrder)
		: 'desc';

	const [result, accounts] = await Promise.all([
		listTransactionsPaginated(bookId, {
			accountId,
			uncategorized,
			status,
			from: from ? new Date(from) : undefined,
			to: to ? new Date(to) : undefined,
			search,
			amountMin,
			amountMax,
			limit,
			sortBy,
			sortOrder
		}),
		listAccounts(bookId)
	]);

	return {
		transactions: result.transactions.map((t) => ({
			...t,
			amount: Number(t.amount),
			date: t.date.toISOString()
		})),
		nextCursor: result.nextCursor,
		accounts: accounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		})),
		filters: { accountId: accountParam, status, from, to, search, amountMin, amountMax, limit },
		sort: { sortBy, sortOrder }
	};
}

export const actions = {
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

	flip: async ({ request }) => {
		const data = await request.formData();
		const ids = data.getAll('ids') as string[];

		if (ids.length === 0) {
			return fail(400, { error: 'No transactions selected' });
		}

		try {
			const result = await flipTransactionAccounts(ids);
			return { success: true, updated: result.updated };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
