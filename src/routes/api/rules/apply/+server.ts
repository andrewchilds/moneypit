import { json } from '@sveltejs/kit';
import { applyRules } from '$lib/server/actions/rules';

export async function POST({ request, locals }) {
	const { bookId } = locals;
	const body = await request.json().catch(() => ({}));
	const accountId = body.accountId as string | undefined;

	const result = await applyRules(bookId, { accountId });

	return json(result);
}
