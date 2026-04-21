import { getUncategorized, categorizeTransactionsAuto } from '$lib/server/actions/transactions';
import { listAccounts, createAccount } from '$lib/server/actions/accounts';
import { createRule } from '$lib/server/actions/rules';
import { fail } from '@sveltejs/kit';

export async function load({ locals }) {
	const { bookId } = locals;
	const [transactions, accounts] = await Promise.all([getUncategorized(bookId), listAccounts(bookId)]);

	// Group by similar descriptions
	const groups = new Map<string, typeof transactions>();
	for (const tx of transactions) {
		// Normalize description for grouping
		const key = tx.description
			.toLowerCase()
			// Remove alphanumeric suffixes after * or # (e.g., AMAZON MKTPL*L52TX5AH3)
			.replace(/[*#][a-z0-9]+$/i, '')
			// Remove pure numeric sequences (but not digits attached to letters)
			.replace(/(?<![a-z])[0-9]+(?![a-z0-9])/gi, '')
			// Remove punctuation (except spaces)
			.replace(/[^a-z0-9\s]/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key)!.push(tx);
	}

	// Sort groups by count (most common first)
	const sortedGroups = Array.from(groups.entries())
		.sort((a, b) => b[1].length - a[1].length)
		.map(([key, txs]) => {
			const transactions = txs.map((t) => ({
				...t,
				amount: Number(t.amount),
				date: t.date.toISOString()
			}));

			// Group by amount to find recurring charges
			const amountGroups = new Map<number, typeof transactions>();
			for (const tx of transactions) {
				const amount = tx.amount;
				if (!amountGroups.has(amount)) {
					amountGroups.set(amount, []);
				}
				amountGroups.get(amount)!.push(tx);
			}

			// Create subgroups: recurring amounts (2+) first, then unique amounts
			const subgroups: { amount: number; isRecurring: boolean; transactions: typeof transactions }[] = [];
			const recurring: typeof subgroups = [];
			const unique: typeof transactions = [];

			for (const [amount, amountTxs] of amountGroups) {
				if (amountTxs.length >= 2) {
					recurring.push({ amount, isRecurring: true, transactions: amountTxs });
				} else {
					unique.push(...amountTxs);
				}
			}

			// Sort recurring by count descending
			recurring.sort((a, b) => b.transactions.length - a.transactions.length);
			subgroups.push(...recurring);

			// Add unique amounts as a single subgroup if any exist
			if (unique.length > 0) {
				// Sort unique by date descending
				unique.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
				subgroups.push({ amount: 0, isRecurring: false, transactions: unique });
			}

			return {
				key,
				pattern: txs[0].description,
				transactions,
				subgroups
			};
		});

	return {
		groups: sortedGroups,
		totalPending: transactions.length,
		accounts: accounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		}))
	};
}

export const actions = {
	categorize: async ({ request, locals }) => {
		const { bookId } = locals;
		const data = await request.formData();
		const ids = data.getAll('ids') as string[];
		let accountId = data.get('accountId') as string;
		const isNewAccount = data.get('isNewAccount') === 'true';
		const newAccountPath = data.get('newAccountPath') as string;

		if (ids.length === 0 || !accountId) {
			return fail(400, { error: 'Missing required fields' });
		}

		try {
			// Create the account if it's new
			if (isNewAccount && newAccountPath) {
				const newAccount = await createAccount(bookId, 'EXPENSE', newAccountPath);
				accountId = newAccount.id;
			}

			const result = await categorizeTransactionsAuto(ids, accountId);
			return { success: true, updated: result.updated };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	createRule: async ({ request, locals }) => {
		const { bookId } = locals;
		const data = await request.formData();
		const pattern = data.get('pattern') as string;
		const accountId = data.get('accountId') as string;
		const isRegex = data.get('isRegex') === 'true';

		if (!pattern || !accountId) {
			return fail(400, { ruleError: 'Pattern and account are required' });
		}

		try {
			const rule = await createRule(bookId, pattern, accountId, { isRegex });
			return { ruleSuccess: true, ruleId: rule.id };
		} catch (e) {
			return fail(400, { ruleError: (e as Error).message });
		}
	}
};
