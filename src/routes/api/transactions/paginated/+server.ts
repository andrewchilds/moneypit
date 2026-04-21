import { json } from '@sveltejs/kit';
import { listTransactionsPaginated, type SortColumn, type SortOrder } from '$lib/server/actions/transactions';
import type { TransactionStatus } from '@prisma/client';

const validSortColumns: SortColumn[] = ['date', 'amount', 'description'];
const validSortOrders: SortOrder[] = ['asc', 'desc'];

export async function GET({ url, locals }) {
	const { bookId } = locals;
	const accountParam = url.searchParams.get('accountId') ?? undefined;
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
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limit = url.searchParams.get('limit');

	const sortByParam = url.searchParams.get('sort');
	const sortOrderParam = url.searchParams.get('order');
	const sortBy = validSortColumns.includes(sortByParam as SortColumn)
		? (sortByParam as SortColumn)
		: 'date';
	const sortOrder = validSortOrders.includes(sortOrderParam as SortOrder)
		? (sortOrderParam as SortOrder)
		: 'desc';

	const result = await listTransactionsPaginated(bookId, {
		accountId,
		uncategorized,
		status,
		from: from ? new Date(from) : undefined,
		to: to ? new Date(to) : undefined,
		search,
		amountMin,
		amountMax,
		cursor,
		limit: limit ? parseInt(limit, 10) : 100,
		sortBy,
		sortOrder
	});

	const transactions = result.transactions.map((t) => ({
		...t,
		amount: Number(t.amount),
		date: t.date.toISOString()
	}));

	return json({
		transactions,
		nextCursor: result.nextCursor
	});
}
