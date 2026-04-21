import { findMergeCandidates, mergeTransactions, dismissDuplicate } from '$lib/server/actions/transactions';
import { fail } from '@sveltejs/kit';

export async function load({ locals }) {
	const { bookId } = locals;
	const candidates = await findMergeCandidates(bookId);

	return {
		candidates: candidates.map((c) => ({
			tx1: {
				...c.tx1,
				amount: Number(c.tx1.amount),
				date: c.tx1.date.toISOString()
			},
			tx2: {
				...c.tx2,
				amount: Number(c.tx2.amount),
				date: c.tx2.date.toISOString()
			},
			score: c.score,
			reasons: c.reasons
		})),
		totalCandidates: candidates.length
	};
}

export const actions = {
	merge: async ({ request }) => {
		const data = await request.formData();
		const id1 = data.get('id1') as string;
		const id2 = data.get('id2') as string;

		if (!id1 || !id2) {
			return fail(400, { error: 'Missing transaction IDs' });
		}

		try {
			const result = await mergeTransactions(id1, id2);
			return { success: true, ...result };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	dismiss: async ({ request }) => {
		const data = await request.formData();
		const id1 = data.get('id1') as string;
		const id2 = data.get('id2') as string;

		if (!id1 || !id2) {
			return fail(400, { error: 'Missing transaction IDs' });
		}

		try {
			await dismissDuplicate(id1, id2);
			return { dismissed: true, id1, id2 };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
