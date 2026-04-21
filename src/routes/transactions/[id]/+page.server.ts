import { parseLocalDate } from '$lib/utils/date';
import { getTransaction, updateTransaction, deleteTransaction } from '$lib/server/actions/transactions';
import { listAccounts } from '$lib/server/actions/accounts';
import { error, fail, redirect } from '@sveltejs/kit';

export async function load({ params, locals }) {
	const { bookId } = locals;
	const transaction = await getTransaction(params.id);

	if (!transaction) {
		throw error(404, 'Transaction not found');
	}

	const accounts = await listAccounts(bookId);

	return {
		transaction: {
			...transaction,
			amount: Number(transaction.amount),
			date: transaction.date.toISOString().split('T')[0]
		},
		accounts: accounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		}))
	};
}

export const actions = {
	update: async ({ params, request }) => {
		const data = await request.formData();

		const updates: Parameters<typeof updateTransaction>[1] = {};

		const date = data.get('date') as string;
		if (date) updates.date = parseLocalDate(date);

		const description = data.get('description') as string;
		if (description !== null) updates.description = description;

		const memo = data.get('memo') as string;
		if (memo !== null) updates.memo = memo || undefined;

		const amount = data.get('amount') as string;
		if (amount) updates.amount = parseFloat(amount);

		const debitAccountId = data.get('debitAccountId') as string;
		if (debitAccountId !== null) updates.debitAccountId = debitAccountId || null;

		const creditAccountId = data.get('creditAccountId') as string;
		if (creditAccountId !== null) updates.creditAccountId = creditAccountId || null;

		const status = data.get('status') as string;
		if (status) updates.status = status as 'PENDING' | 'CATEGORIZED';

		try {
			await updateTransaction(params.id, updates);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	delete: async ({ params }) => {
		try {
			await deleteTransaction(params.id);
			throw redirect(303, '/transactions');
		} catch (e) {
			if ((e as { status?: number }).status === 303) throw e;
			return fail(400, { error: (e as Error).message });
		}
	}
};
