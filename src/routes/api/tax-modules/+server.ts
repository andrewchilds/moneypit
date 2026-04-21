import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAvailableModules, enableModule, disableModule } from '$lib/server/actions/taxModules';

export const GET: RequestHandler = async ({ url }) => {
	const bookId = url.searchParams.get('bookId');
	if (!bookId) {
		return json({ error: 'bookId required' }, { status: 400 });
	}
	const modules = await getAvailableModules(bookId);
	return json(modules);
};

export const POST: RequestHandler = async ({ request }) => {
	const { bookId, moduleId, action } = await request.json();

	if (!bookId || !moduleId || !action) {
		return json({ error: 'bookId, moduleId, and action required' }, { status: 400 });
	}

	if (action === 'enable') {
		const result = await enableModule(bookId, moduleId);
		return json(result);
	} else if (action === 'disable') {
		const result = await disableModule(bookId, moduleId);
		return json(result);
	} else {
		return json({ error: 'Invalid action. Use "enable" or "disable"' }, { status: 400 });
	}
};
