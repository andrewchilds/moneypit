import { db } from '../db';
import { getModule, getAllModules } from '../taxModules';
import type { TaxModule } from '../taxModules';

export interface EnabledModule {
	moduleId: string;
	module: TaxModule;
	enabledAt: Date;
}

export interface EnableModuleResult {
	success: boolean;
	categoriesCreated: number;
}

export interface DisableModuleResult {
	success: boolean;
	categoriesDeleted: number;
	categoriesRetained: number;
	retainedCategories: { id: string; name: string; accountCount: number }[];
}

/**
 * Get all available modules with their enabled status for a book.
 */
export async function getAvailableModules(bookId: string): Promise<{
	module: TaxModule;
	enabled: boolean;
	enabledAt: Date | null;
}[]> {
	const enabledModules = await db.bookTaxModule.findMany({
		where: { bookId }
	});

	const enabledMap = new Map(enabledModules.map((m) => [m.moduleId, m.enabledAt]));

	return getAllModules().map((module) => ({
		module,
		enabled: enabledMap.has(module.id),
		enabledAt: enabledMap.get(module.id) ?? null
	}));
}

/**
 * Get enabled modules for a book.
 */
export async function getEnabledModules(bookId: string): Promise<EnabledModule[]> {
	const bookModules = await db.bookTaxModule.findMany({
		where: { bookId },
		orderBy: { enabledAt: 'asc' }
	});

	const result: EnabledModule[] = [];
	for (const bm of bookModules) {
		const module = getModule(bm.moduleId);
		if (module) {
			result.push({
				moduleId: bm.moduleId,
				module,
				enabledAt: bm.enabledAt
			});
		}
	}

	return result;
}

/**
 * Enable a module for a book. Creates the BookTaxModule record and seeds
 * any categories that don't already exist.
 */
export async function enableModule(bookId: string, moduleId: string): Promise<EnableModuleResult> {
	const module = getModule(moduleId);
	if (!module) {
		throw new Error(`Unknown module: ${moduleId}`);
	}

	// Check if already enabled
	const existing = await db.bookTaxModule.findUnique({
		where: { bookId_moduleId: { bookId, moduleId } }
	});

	if (existing) {
		return { success: true, categoriesCreated: 0 };
	}

	// Create the BookTaxModule record and seed categories in a transaction
	let categoriesCreated = 0;

	await db.$transaction(async (tx) => {
		// Enable the module
		await tx.bookTaxModule.create({
			data: { bookId, moduleId }
		});

		// Get existing categories in this book to avoid duplicates
		const existingCategories = await tx.taxCategory.findMany({
			where: { bookId },
			select: { name: true, scheduleRef: true }
		});

		const existingSet = new Set(
			existingCategories.map((c) => `${c.name}|${c.scheduleRef ?? ''}`)
		);

		// Create categories from the module that don't already exist
		for (const cat of module.categories) {
			const key = `${cat.name}|${cat.scheduleRef}`;
			if (!existingSet.has(key)) {
				await tx.taxCategory.create({
					data: {
						bookId,
						name: cat.name,
						scheduleRef: cat.scheduleRef,
						description: cat.description,
						moduleId
					}
				});
				categoriesCreated++;
			}
		}
	});

	return { success: true, categoriesCreated };
}

/**
 * Disable a module for a book. Removes the BookTaxModule record and deletes
 * any categories from that module that aren't used by any accounts.
 */
export async function disableModule(bookId: string, moduleId: string): Promise<DisableModuleResult> {
	const module = getModule(moduleId);
	if (!module) {
		throw new Error(`Unknown module: ${moduleId}`);
	}

	// Check if enabled
	const existing = await db.bookTaxModule.findUnique({
		where: { bookId_moduleId: { bookId, moduleId } }
	});

	if (!existing) {
		return { success: true, categoriesDeleted: 0, categoriesRetained: 0, retainedCategories: [] };
	}

	// Find categories from this module
	const moduleCategories = await db.taxCategory.findMany({
		where: { bookId, moduleId },
		include: {
			_count: { select: { accounts: true } }
		}
	});

	const toDelete: string[] = [];
	const retained: { id: string; name: string; accountCount: number }[] = [];

	for (const cat of moduleCategories) {
		if (cat._count.accounts === 0) {
			toDelete.push(cat.id);
		} else {
			retained.push({
				id: cat.id,
				name: cat.name,
				accountCount: cat._count.accounts
			});
		}
	}

	// Delete the module record and unused categories in a transaction
	await db.$transaction(async (tx) => {
		await tx.bookTaxModule.delete({
			where: { bookId_moduleId: { bookId, moduleId } }
		});

		if (toDelete.length > 0) {
			await tx.taxCategory.deleteMany({
				where: { id: { in: toDelete } }
			});
		}

		// Clear moduleId from retained categories (they become user-owned)
		if (retained.length > 0) {
			await tx.taxCategory.updateMany({
				where: { id: { in: retained.map((r) => r.id) } },
				data: { moduleId: null }
			});
		}
	});

	return {
		success: true,
		categoriesDeleted: toDelete.length,
		categoriesRetained: retained.length,
		retainedCategories: retained
	};
}
