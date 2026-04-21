import { json } from '@sveltejs/kit';
import { listAccounts } from '$lib/server/actions/accounts';
import { listRules } from '$lib/server/actions/rules';
import { getUncategorized } from '$lib/server/actions/transactions';

export async function GET({ url, locals }) {
	const { bookId } = locals;
	const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

	const [accounts, rules, uncategorized] = await Promise.all([
		listAccounts(bookId),
		listRules(bookId),
		getUncategorized(bookId, { limit })
	]);

	return json({
		bookId,
		accounts: accounts.map(a => ({
			id: a.id,
			type: a.type,
			path: a.path
		})),
		rules: rules.map(r => ({
			id: r.id,
			pattern: r.pattern,
			field: r.field,
			isRegex: r.isRegex,
			accountType: r.account.type,
			accountPath: r.account.path,
			amountMin: r.amountMin ? Number(r.amountMin) : null,
			amountMax: r.amountMax ? Number(r.amountMax) : null,
			amountExact: r.amountExact ? Number(r.amountExact) : null
		})),
		uncategorizedTransactions: uncategorized.map(tx => ({
			id: tx.id,
			date: tx.date.toISOString().split('T')[0],
			description: tx.description,
			amount: `$${Number(tx.amount).toFixed(2)}`,
			creditAccount: tx.creditAccount?.path ?? '(pending)',
			debitAccount: tx.debitAccount?.path ?? '(pending)'
		})),
		totalUncategorized: uncategorized.length
	});
}
