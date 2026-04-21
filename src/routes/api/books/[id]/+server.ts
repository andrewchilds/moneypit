import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBook, updateBook, deleteBook } from '$lib/server/actions/books';

export const GET: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found');
	return json(book);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const data = await request.json();
	const book = await updateBook(params.id, data);
	return json(book);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (params.id === locals.bookId) {
		throw error(400, 'Cannot delete the currently active book');
	}
	await deleteBook(params.id);
	return json({ success: true });
};
