import { error } from '@sveltejs/kit';
import { getTaxReturn } from '$lib/server/actions/taxReturn';
import { renderReturnPdf } from '$lib/server/taxReturn/pdf';

/**
 * The draft return as filled IRS forms:
 * GET /reports/tax/return/pdf?year=<year>
 */
export async function GET({ url, locals }) {
	const year = parseInt(url.searchParams.get('year') ?? '', 10);
	if (!Number.isInteger(year)) throw error(400, 'year is required');

	const result = await getTaxReturn(locals.bookId, year);
	if (!result.available) throw error(404, result.reason);

	let bytes: Uint8Array;
	try {
		bytes = await renderReturnPdf(result.computation);
	} catch (e) {
		throw error(500, (e as Error).message);
	}
	return new Response(new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="return-${year}-draft.pdf"`,
			'Content-Length': String(bytes.byteLength)
		}
	});
}
