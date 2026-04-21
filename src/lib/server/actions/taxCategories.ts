import { db } from '../db';
import type { TaxCategory } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';

export interface CreateTaxCategoryData {
	name: string;
	description?: string;
	scheduleRef?: string;
	year?: number;
}

export interface UpdateTaxCategoryData {
	name?: string;
	description?: string;
	scheduleRef?: string;
	year?: number;
}

export async function listTaxCategories(bookId: string, year?: number): Promise<TaxCategory[]> {
	return db.taxCategory.findMany({
		where: { bookId, ...(year ? { year } : {}) },
		orderBy: { name: 'asc' }
	});
}

export async function getTaxCategory(id: string): Promise<TaxCategory | null> {
	return db.taxCategory.findUnique({ where: { id } });
}

export async function createTaxCategory(bookId: string, data: CreateTaxCategoryData): Promise<TaxCategory> {
	const result = await db.taxCategory.create({ data: { bookId, ...data } });

	await logOperation(bookId, 'CREATE', `Created tax category: ${result.name}`, [
		{
			entityType: 'TaxCategory',
			entityId: result.id,
			before: null,
			after: serialize(result)
		}
	]);

	return result;
}

export async function updateTaxCategory(
	id: string,
	data: UpdateTaxCategoryData
): Promise<TaxCategory> {
	const before = await db.taxCategory.findUniqueOrThrow({ where: { id } });

	const result = await db.taxCategory.update({
		where: { id },
		data
	});

	const { before: beforeDiff, after: afterDiff } = diff(serialize(before), serialize(result));
	if (Object.keys(beforeDiff).length > 0) {
		await logOperation(result.bookId, 'UPDATE', `Updated tax category: ${result.name}`, [
			{
				entityType: 'TaxCategory',
				entityId: id,
				before: beforeDiff,
				after: afterDiff
			}
		]);
	}

	return result;
}

export async function deleteTaxCategory(id: string): Promise<void> {
	// Check for accounts using this category
	const accountCount = await db.account.count({
		where: { taxCategoryId: id }
	});

	if (accountCount > 0) {
		throw new Error(`Cannot delete tax category: ${accountCount} accounts reference it`);
	}

	const before = await db.taxCategory.findUniqueOrThrow({ where: { id } });
	await db.taxCategory.delete({ where: { id } });

	await logOperation(before.bookId, 'DELETE', `Deleted tax category: ${before.name}`, [
		{
			entityType: 'TaxCategory',
			entityId: id,
			before: serialize(before),
			after: null
		}
	]);
}
