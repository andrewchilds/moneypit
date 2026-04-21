import { json, error } from '@sveltejs/kit';
import { getAccount } from '$lib/server/actions/accounts';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import { db } from '$lib/server/db';

export async function GET({ url, locals }) {
	const { bookId } = locals;
	const accountId = url.searchParams.get('accountId');

	if (!accountId) {
		throw error(400, 'accountId is required');
	}

	const account = await getAccount(accountId);
	if (!account) {
		throw error(404, 'Account not found');
	}

	// Get sample transactions for this account (most recent 20)
	const transactions = await db.transaction.findMany({
		where: {
			bookId,
			mergedIntoId: null,
			OR: [
				{ debitAccountId: accountId },
				{ creditAccountId: accountId }
			]
		},
		orderBy: { date: 'desc' },
		take: 20,
		select: {
			date: true,
			description: true,
			amount: true
		}
	});

	const transactionCount = await db.transaction.count({
		where: {
			bookId,
			mergedIntoId: null,
			OR: [
				{ debitAccountId: accountId },
				{ creditAccountId: accountId }
			]
		}
	});

	const taxCategories = await listTaxCategories(bookId);

	return json({
		bookId,
		account: {
			id: account.id,
			type: account.type,
			path: account.path
		},
		transactionCount,
		taxCategories: taxCategories.map(tc => ({
			id: tc.id,
			name: tc.name,
			scheduleRef: tc.scheduleRef,
			description: tc.description
		})),
		sampleTransactions: transactions.map(tx => ({
			date: tx.date.toISOString().split('T')[0],
			description: tx.description,
			amount: `$${Number(tx.amount).toFixed(2)}`
		}))
	});
}
