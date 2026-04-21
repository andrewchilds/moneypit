import { json, error } from '@sveltejs/kit';
import { getAccount } from '$lib/server/actions/accounts';
import { listRulesForAccount } from '$lib/server/actions/rules';
import { getTransactionSummary, countTransactionsForAccount, getUncategorized } from '$lib/server/actions/transactions';

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

	const [rules, transactionSummary, transactionCount, uncategorized] = await Promise.all([
		listRulesForAccount(accountId),
		getTransactionSummary(bookId, accountId, 50),
		countTransactionsForAccount(accountId),
		getUncategorized(bookId, { limit: 250 })
	]);

	return json({
		bookId,
		account: {
			id: account.id,
			type: account.type,
			path: account.path
		},
		transactionCount,
		rules: rules.map(r => ({
			id: r.id,
			pattern: r.pattern,
			field: r.field,
			isRegex: r.isRegex,
			priority: r.priority,
			amountMin: r.amountMin ? Number(r.amountMin) : null,
			amountMax: r.amountMax ? Number(r.amountMax) : null,
			amountExact: r.amountExact ? Number(r.amountExact) : null
		})),
		transactionSummary: transactionSummary.map(g => ({
			description: g.description,
			count: g.count,
			totalAmount: g.totalAmount,
			minAmount: g.minAmount,
			maxAmount: g.maxAmount,
			dateRange: {
				earliest: g.dateRange.earliest.toISOString().split('T')[0],
				latest: g.dateRange.latest.toISOString().split('T')[0]
			}
		})),
		uncategorizedTransactions: uncategorized.map(tx => ({
			id: tx.id,
			date: tx.date.toISOString().split('T')[0],
			description: tx.description,
			amount: `$${Number(tx.amount).toFixed(2)}`,
			creditAccount: tx.creditAccount?.path ?? '(pending)',
			debitAccount: tx.debitAccount?.path ?? '(pending)'
		}))
	});
}
