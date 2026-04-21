import { getAccountTree, createAccount, listAccounts, updateAccount } from '$lib/server/actions/accounts';
import { listTaxCategories } from '$lib/server/actions/taxCategories';
import { db } from '$lib/server/db';
import type { AccountType, AssetType } from '@prisma/client';
import { fail } from '@sveltejs/kit';

export async function load({ locals }) {
	const { bookId } = locals;

	const [tree, accounts, taxCategories] = await Promise.all([
		getAccountTree(bookId),
		listAccounts(bookId),
		listTaxCategories(bookId)
	]);

	// Calculate balances for each account (opening balance + debits - credits)
	const balances = await db.$queryRaw<{ accountId: string; balance: number }[]>`
		SELECT
			a.id as "accountId",
			COALESCE(a."openingBalance", 0) + COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "debitAccountId" = a.id AND "merged_into_id" IS NULL),
				0
			) - COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "creditAccountId" = a.id AND "merged_into_id" IS NULL),
				0
			) as balance
		FROM "Account" a
		WHERE a."bookId" = ${bookId}
	`;

	// Get rule counts per account
	const ruleCounts = await db.$queryRaw<{ accountId: string; count: bigint }[]>`
		SELECT "accountId", COUNT(*) as count FROM "Rule" WHERE "bookId" = ${bookId} GROUP BY "accountId"
	`;

	const balanceMap = new Map(balances.map((b) => [b.accountId, Number(b.balance)]));
	const ruleCountMap = new Map(ruleCounts.map((r) => [r.accountId, Number(r.count)]));

	// Calculate totals by account type
	const totals = { ASSET: 0, LIABILITY: 0, EQUITY: 0, INCOME: 0, EXPENSE: 0 };
	for (const account of accounts) {
		const balance = balanceMap.get(account.id) ?? 0;
		totals[account.type] += balance;
	}

	// Calculate liquid assets (excludes TAX_DEFERRED accounts)
	let liquidAssets = 0;
	for (const account of accounts) {
		if (account.type === 'ASSET' && account.assetType !== 'TAX_DEFERRED') {
			liquidAssets += balanceMap.get(account.id) ?? 0;
		}
	}

	return {
		tree,
		accounts: accounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		})),
		balances: Object.fromEntries(balanceMap),
		ruleCounts: Object.fromEntries(ruleCountMap),
		totals,
		liquidAssets,
		taxCategories
	};
}

export const actions = {
	create: async ({ request, locals }) => {
		const { bookId } = locals;
		const data = await request.formData();
		const type = data.get('type') as AccountType;
		const path = data.get('path') as string;
		const taxCategoryId = data.get('taxCategoryId') as string | null;
		const openingBalanceStr = data.get('openingBalance') as string | null;
		const last4 = data.get('last4') as string | null;
		const assetTypeStr = data.get('assetType') as string | null;

		if (!type || !path) {
			return fail(400, { error: 'Type and path are required' });
		}

		const openingBalance = openingBalanceStr ? parseFloat(openingBalanceStr) : undefined;
		const assetType = assetTypeStr && type === 'ASSET' ? (assetTypeStr as AssetType) : undefined;

		try {
			const account = await createAccount(bookId, type, path.trim(), {
				taxCategoryId: taxCategoryId || undefined,
				openingBalance,
				last4: last4 || undefined,
				assetType
			});
			return { success: true, account };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	updateTaxCategory: async ({ request }) => {
		const data = await request.formData();
		const accountId = data.get('accountId') as string;
		const taxCategoryId = data.get('taxCategoryId') as string | null;

		if (!accountId) {
			return fail(400, { error: 'Account ID is required' });
		}

		try {
			await updateAccount(accountId, {
				taxCategoryId: taxCategoryId || null
			});
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
