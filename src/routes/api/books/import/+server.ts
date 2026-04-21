import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importBook, type BookExport } from '$lib/server/actions/bookTransfer';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { data, name } = body as { data: BookExport; name?: string };

	if (!data || !data.version) {
		throw error(400, 'Invalid export data');
	}

	try {
		const result = await importBook(data, { name });
		return json(result);
	} catch (err) {
		if (err instanceof Error && err.message.includes('already exists')) {
			throw error(409, err.message);
		}
		throw err;
	}
};
