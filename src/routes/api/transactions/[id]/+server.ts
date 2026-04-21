import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';

export async function GET({ params }) {
	const transaction = await db.transaction.findUnique({
		where: { id: params.id },
		include: {
			debitAccount: { select: { id: true, path: true, type: true } },
			creditAccount: { select: { id: true, path: true, type: true } }
		}
	});

	if (!transaction) {
		throw error(404, 'Transaction not found');
	}

	return json({
		...transaction,
		amount: Number(transaction.amount),
		date: transaction.date.toISOString()
	});
}
