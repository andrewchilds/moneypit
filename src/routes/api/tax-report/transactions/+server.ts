import { json, error } from '@sveltejs/kit';
import { getTaxAccountTransactions } from '$lib/server/actions/reports';

/**
 * The transactions behind one account's figure on the tax report:
 * GET /api/tax-report/transactions?account=<id>&year=<year>
 */
export async function GET({ url, locals }) {
	const accountId = url.searchParams.get('account');
	const year = parseInt(url.searchParams.get('year') ?? '', 10);
	if (!accountId) throw error(400, 'account is required');
	if (!Number.isInteger(year)) throw error(400, 'year is required');

	try {
		const result = await getTaxAccountTransactions(locals.bookId, accountId, year);
		return json({
			...result,
			rows: result.rows.map((r) => ({ ...r, date: r.date.toISOString() }))
		});
	} catch (e) {
		throw error(404, (e as Error).message);
	}
}
