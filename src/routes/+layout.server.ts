import type { LayoutServerLoad } from './$types';
import { listBooks } from '$lib/server/actions/books';

export const load: LayoutServerLoad = async ({ locals }) => {
	const books = await listBooks();
	return {
		books,
		bookId: locals.bookId
	};
};
