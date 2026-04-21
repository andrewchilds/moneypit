import { getRecentOperations, undoOperation } from '$lib/server/actions/operationLog';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';

const PAGE_SIZE = 50;

interface Change {
	entityType: string;
	entityId: string;
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
}

// Fields that contain entity IDs we want to resolve
const ID_FIELDS: Record<string, string> = {
	debitAccountId: 'Account',
	creditAccountId: 'Account',
	accountId: 'Account',
	taxCategoryId: 'TaxCategory',
	mergedIntoId: 'Transaction'
};

function collectIds(changes: Change[]): { accounts: Set<string>; transactions: Set<string>; taxCategories: Set<string> } {
	const accounts = new Set<string>();
	const transactions = new Set<string>();
	const taxCategories = new Set<string>();

	for (const change of changes) {
		const data = { ...(change.before ?? {}), ...(change.after ?? {}) };

		for (const [field, entityType] of Object.entries(ID_FIELDS)) {
			const value = data[field];
			if (typeof value === 'string' && value) {
				if (entityType === 'Account') accounts.add(value);
				else if (entityType === 'Transaction') transactions.add(value);
				else if (entityType === 'TaxCategory') taxCategories.add(value);
			}
		}

		// Also collect the entity itself if it's a Transaction
		if (change.entityType === 'Transaction') {
			transactions.add(change.entityId);
		}
	}

	return { accounts, transactions, taxCategories };
}

export async function load({ url, locals }) {
	const { bookId } = locals;
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
	const offset = (page - 1) * PAGE_SIZE;

	const { operations, total } = await getRecentOperations(bookId, PAGE_SIZE, offset);
	const totalPages = Math.ceil(total / PAGE_SIZE);

	// Collect all entity IDs from all operations
	const allAccounts = new Set<string>();
	const allTransactions = new Set<string>();
	const allTaxCategories = new Set<string>();

	for (const op of operations) {
		const changes = op.changes as unknown as Change[];
		const { accounts, transactions, taxCategories } = collectIds(changes);
		accounts.forEach((id) => allAccounts.add(id));
		transactions.forEach((id) => allTransactions.add(id));
		taxCategories.forEach((id) => allTaxCategories.add(id));
	}

	// Fetch entity names in parallel
	const [accounts, transactions, taxCategories] = await Promise.all([
		allAccounts.size > 0
			? db.account.findMany({
					where: { id: { in: Array.from(allAccounts) } },
					select: { id: true, path: true }
				})
			: [],
		allTransactions.size > 0
			? db.transaction.findMany({
					where: { id: { in: Array.from(allTransactions) } },
					select: { id: true, description: true }
				})
			: [],
		allTaxCategories.size > 0
			? db.taxCategory.findMany({
					where: { id: { in: Array.from(allTaxCategories) } },
					select: { id: true, name: true }
				})
			: []
	]);

	// Build lookup maps
	const entityNames: Record<string, string> = {};
	for (const a of accounts) entityNames[a.id] = a.path;
	for (const t of transactions) entityNames[t.id] = t.description;
	for (const tc of taxCategories) entityNames[tc.id] = tc.name;

	return {
		operations: operations.map((op) => ({
			...op,
			createdAt: op.createdAt.toISOString(),
			undoneAt: op.undoneAt?.toISOString() ?? null
		})),
		entityNames,
		page,
		totalPages,
		total
	};
}

export const actions = {
	undo: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;

		if (!id) {
			return fail(400, { error: 'Missing operation ID' });
		}

		try {
			const result = await undoOperation(id);
			return {
				success: true,
				undone: result.undone,
				skipped: result.skipped
			};
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
