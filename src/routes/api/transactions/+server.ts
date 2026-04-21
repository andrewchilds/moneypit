import { json } from '@sveltejs/kit';
import { listTransactionsPaginated, listTransactionsWithBalance } from '$lib/server/actions/transactions';

export async function GET({ url, locals }) {
	const { bookId } = locals;
	const accountId = url.searchParams.get('accountId') ?? undefined;
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limit = url.searchParams.get('limit');
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	// If we have an accountId, use the balance-aware query
	if (accountId) {
		const result = await listTransactionsWithBalance(accountId, {
			cursor,
			limit: limit ? parseInt(limit, 10) : 50,
			from: fromParam ? new Date(fromParam) : undefined,
			to: toParam ? new Date(toParam) : undefined
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

	// Generic transaction list without balance
	const result = await listTransactionsPaginated(bookId, {
		cursor,
		limit: limit ? parseInt(limit, 10) : 50,
		from: fromParam ? new Date(fromParam) : undefined,
		to: toParam ? new Date(toParam) : undefined
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
