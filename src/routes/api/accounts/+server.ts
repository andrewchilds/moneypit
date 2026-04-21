import { json } from '@sveltejs/kit';
import { createAccount } from '$lib/server/actions/accounts';
import type { AccountType } from '@prisma/client';

export async function POST({ request, locals }) {
	const { bookId } = locals;
	const { type, path, last4 } = await request.json();

	if (!type || !path) {
		return json({ message: 'Type and path are required' }, { status: 400 });
	}

	const validTypes: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
	if (!validTypes.includes(type)) {
		return json({ message: 'Invalid account type' }, { status: 400 });
	}

	try {
		const account = await createAccount(bookId, type as AccountType, path, { last4 });
		return json(account);
	} catch (e) {
		return json({ message: (e as Error).message }, { status: 400 });
	}
}
