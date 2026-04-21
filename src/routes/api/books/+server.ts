import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listBooks, createBook } from '$lib/server/actions/books';

export const GET: RequestHandler = async () => {
	const books = await listBooks();
	return json(books);
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();
	const book = await createBook(data);
	return json(book);
};
