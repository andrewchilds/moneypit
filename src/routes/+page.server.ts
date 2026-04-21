import { db } from '$lib/server/db';
import { activeTransactionFilter } from '$lib/server/actions/transactions';

export async function load({ locals }) {
	const { bookId } = locals;

	const [accountCount, pendingCount, recentImports] = await Promise.all([
		db.account.count({ where: { bookId } }),
		db.transaction.count({ where: { bookId, status: 'PENDING', ...activeTransactionFilter } }),
		db.transaction.findMany({
			where: { bookId, importSource: { not: null } },
			select: { importSource: true, createdAt: true },
			distinct: ['importSource'],
			orderBy: { createdAt: 'desc' },
			take: 5
		})
	]);

	// Get account totals by type
	const accountsByType = await db.account.groupBy({
		by: ['type'],
		where: { bookId },
		_count: { id: true }
	});

	return {
		stats: {
			accountCount,
			pendingCount,
			accountsByType: accountsByType.reduce(
				(acc, { type, _count }) => {
					acc[type] = _count.id;
					return acc;
				},
				{} as Record<string, number>
			)
		},
		recentImports: recentImports.map((i) => ({
			source: i.importSource,
			date: i.createdAt.toISOString()
		}))
	};
}
