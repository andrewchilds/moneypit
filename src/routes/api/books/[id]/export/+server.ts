import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBook } from '$lib/server/actions/books';
import { exportBook } from '$lib/server/actions/bookTransfer';

export const GET: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found');

	const exportData = await exportBook(params.id);

	return json(exportData);
};
