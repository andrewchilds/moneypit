import { db } from '../db';
import type { AccountType, AssetType, Account } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';

export interface AccountFilter {
	type?: AccountType;
	pathPrefix?: string;
}

export interface CreateAccountOptions {
	taxCategoryId?: string;
	openingBalance?: number;
	last4?: string;
	assetType?: AssetType;
}

export interface AccountTreeNode {
	id: string;
	type: AccountType;
	path: string;
	name: string;
	taxCategoryId: string | null;
	last4: string | null;
	assetType: AssetType | null;
	children: AccountTreeNode[];
}

export async function listAccounts(bookId: string, filter?: AccountFilter): Promise<Account[]> {
	return db.account.findMany({
		where: {
			bookId,
			type: filter?.type,
			path: filter?.pathPrefix ? { startsWith: filter.pathPrefix } : undefined
		},
		orderBy: [{ type: 'asc' }, { path: 'asc' }]
	});
}

export async function getAccount(id: string): Promise<Account | null> {
	return db.account.findUnique({ where: { id } });
}

export async function getAccountByPath(bookId: string, type: AccountType, path: string): Promise<Account | null> {
	return db.account.findUnique({
		where: { bookId_type_path: { bookId, type, path } }
	});
}

export async function createAccount(
	bookId: string,
	type: AccountType,
	path: string,
	opts?: CreateAccountOptions
): Promise<Account> {
	const result = await db.account.create({
		data: {
			bookId,
			type,
			path,
			taxCategoryId: opts?.taxCategoryId,
			openingBalance: opts?.openingBalance,
			last4: opts?.last4,
			assetType: opts?.assetType
		}
	});

	await logOperation(bookId, 'CREATE', `Created account: ${type}:${path}`, [
		{
			entityType: 'Account',
			entityId: result.id,
			before: null,
			after: serialize(result)
		}
	]);

	return result;
}

export async function updateAccount(
	id: string,
	data: {
		type?: AccountType;
		path?: string;
		taxCategoryId?: string | null;
		openingBalance?: number | null;
		last4?: string | null;
		assetType?: AssetType | null;
	}
): Promise<Account> {
	const before = await db.account.findUniqueOrThrow({ where: { id } });

	const result = await db.account.update({
		where: { id },
		data
	});

	const { before: beforeDiff, after: afterDiff } = diff(serialize(before), serialize(result));
	if (Object.keys(beforeDiff).length > 0) {
		await logOperation(result.bookId, 'UPDATE', `Updated account: ${result.type}:${result.path}`, [
			{
				entityType: 'Account',
				entityId: id,
				before: beforeDiff,
				after: afterDiff
			}
		]);
	}

	return result;
}

export async function deleteAccount(id: string): Promise<void> {
	// Check for transactions
	const txCount = await db.transaction.count({
		where: {
			OR: [{ debitAccountId: id }, { creditAccountId: id }]
		}
	});

	if (txCount > 0) {
		throw new Error(`Cannot delete account: ${txCount} transactions reference it`);
	}

	// Check for rules
	const ruleCount = await db.rule.count({
		where: { accountId: id }
	});

	if (ruleCount > 0) {
		throw new Error(`Cannot delete account: ${ruleCount} rules reference it`);
	}

	const before = await db.account.findUniqueOrThrow({ where: { id } });
	await db.account.delete({ where: { id } });

	await logOperation(before.bookId, 'DELETE', `Deleted account: ${before.type}:${before.path}`, [
		{
			entityType: 'Account',
			entityId: id,
			before: serialize(before),
			after: null
		}
	]);
}

export async function getAccountTree(bookId: string, type?: AccountType): Promise<AccountTreeNode[]> {
	const accounts = await listAccounts(bookId, type ? { type } : undefined);

	const nodeMap = new Map<string, AccountTreeNode>();
	const roots: AccountTreeNode[] = [];

	// Create nodes for all accounts
	for (const account of accounts) {
		const parts = account.path.split(':');
		const name = parts[parts.length - 1];

		nodeMap.set(`${account.type}:${account.path}`, {
			id: account.id,
			type: account.type,
			path: account.path,
			name,
			taxCategoryId: account.taxCategoryId,
			last4: account.last4,
			assetType: account.assetType,
			children: []
		});
	}

	// Ensure virtual parent nodes exist for all nested paths
	for (const account of accounts) {
		const parts = account.path.split(':');
		for (let i = 1; i < parts.length; i++) {
			const parentPath = parts.slice(0, i).join(':');
			const parentKey = `${account.type}:${parentPath}`;
			if (!nodeMap.has(parentKey)) {
				nodeMap.set(parentKey, {
					id: `virtual:${account.type}:${parentPath}`,
					type: account.type,
					path: parentPath,
					name: parts[i - 1],
					taxCategoryId: null,
					last4: null,
					assetType: null,
					children: []
				});
			}
		}
	}

	// Build tree structure
	for (const node of nodeMap.values()) {
		const parts = node.path.split(':');

		if (parts.length === 1) {
			roots.push(node);
		} else {
			const parentPath = parts.slice(0, -1).join(':');
			const parentKey = `${node.type}:${parentPath}`;
			const parent = nodeMap.get(parentKey);
			parent!.children.push(node);
		}
	}

	return roots;
}
