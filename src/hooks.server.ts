import type { Handle } from '@sveltejs/kit';
import { runBackup } from '$lib/server/backup';
import { readConfig } from '$lib/server/config';
import { getDefaultBook } from '$lib/server/actions/books';

runBackup();

export const handle: Handle = async ({ event, resolve }) => {
	// Get bookId from cookie, config, or default
	let bookId = event.cookies.get('bookId');

	if (!bookId) {
		const config = readConfig();
		bookId = config.defaultBookId;
	}

	if (!bookId) {
		const defaultBook = await getDefaultBook();
		bookId = defaultBook.id;
	}

	event.locals.bookId = bookId;

	return resolve(event);
};
