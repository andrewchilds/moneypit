import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getDocumentFile } from '$lib/server/actions/taxDocuments';
import type { RequestHandler } from './$types';

/** Serve the file attached to a tax document, inline, for the viewer. */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	const document = await db.taxDocument.findUnique({ where: { id: params.id }, select: { bookId: true } });
	if (!document || document.bookId !== locals.bookId) throw error(404, 'Document not found');
	const file = await getDocumentFile(params.id);
	if (!file) throw error(404, 'No file attached');

	const etag = `"${file.id}"`;
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304 });

	const safeName = file.filename.replace(/[^\w.-]+/g, '_');
	return new Response(new Uint8Array(file.data), {
		headers: {
			'Content-Type': file.mimeType,
			'Content-Length': String(file.size),
			'Content-Disposition': `inline; filename="${safeName}"`,
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
