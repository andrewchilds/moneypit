import { describe, it, expect } from 'bun:test';

/**
 * Unit tests for expenses report logic.
 * These test the pure functions without database access.
 */

// Types matching the report
interface ExpenseCategoryNode {
	id: string;
	path: string;
	name: string;
	total: number;
	children: ExpenseCategoryNode[];
}

interface StackedBarSegment {
	label: string;
	value: number;
}

interface MonthlyStackedData {
	month: string;
	segments: StackedBarSegment[];
	total: number;
}

// Helper: Build category tree from flat account list (matching server logic)
function buildCategoryTree(
	accounts: { id: string; path: string }[],
	accountTotals: Map<string, number>
): ExpenseCategoryNode[] {
	const root: ExpenseCategoryNode[] = [];
	const nodeMap = new Map<string, ExpenseCategoryNode>();

	const sortedAccounts = [...accounts].sort((a, b) => a.path.localeCompare(b.path));

	for (const account of sortedAccounts) {
		const total = accountTotals.get(account.id) || 0;
		const parts = account.path.split(':');

		let currentPath = '';
		let parentChildren = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			currentPath = currentPath ? `${currentPath}:${part}` : part;
			const isLeaf = i === parts.length - 1;

			let node = nodeMap.get(currentPath);
			if (!node) {
				node = {
					id: isLeaf ? account.id : `virtual:${currentPath}`,
					path: currentPath,
					name: part,
					total: 0,
					children: []
				};
				nodeMap.set(currentPath, node);
				parentChildren.push(node);
			}

			if (isLeaf) {
				node.total += total;
				// Propagate total up to parents
				let parentPath = parts.slice(0, i).join(':');
				while (parentPath) {
					const parentNode = nodeMap.get(parentPath);
					if (parentNode) {
						parentNode.total += total;
					}
					const parentParts = parentPath.split(':');
					parentParts.pop();
					parentPath = parentParts.join(':');
				}
			}

			parentChildren = node.children;
		}
	}

	// Sort by total descending
	function sortChildren(nodes: ExpenseCategoryNode[]) {
		nodes.sort((a, b) => b.total - a.total);
		for (const node of nodes) {
			sortChildren(node.children);
		}
	}
	sortChildren(root);

	return root;
}

// Helper: Group monthly data by top-level category
function buildMonthlyData(
	monthlyTotals: { accountId: string; month: string; total: number }[],
	accountPaths: Map<string, string>
): MonthlyStackedData[] {
	const monthCategoryTotals = new Map<string, Map<string, number>>();
	const allMonths = new Set<string>();
	const allTopLevelCategories = new Set<string>();

	for (const row of monthlyTotals) {
		const path = accountPaths.get(row.accountId);
		if (!path) continue;

		const topLevel = path.split(':')[0];
		allMonths.add(row.month);
		allTopLevelCategories.add(topLevel);

		if (!monthCategoryTotals.has(row.month)) {
			monthCategoryTotals.set(row.month, new Map());
		}
		const categoryMap = monthCategoryTotals.get(row.month)!;
		categoryMap.set(topLevel, (categoryMap.get(topLevel) || 0) + row.total);
	}

	const sortedMonths = Array.from(allMonths).sort();

	return sortedMonths.map((month) => {
		const categoryMap = monthCategoryTotals.get(month) || new Map();
		const segments: StackedBarSegment[] = [];
		let total = 0;

		for (const category of allTopLevelCategories) {
			const value = categoryMap.get(category) || 0;
			if (value > 0) {
				segments.push({ label: category, value });
				total += value;
			}
		}

		segments.sort((a, b) => b.value - a.value);
		return { month, segments, total };
	});
}

describe('buildCategoryTree', () => {
	it('builds a flat tree for non-hierarchical accounts', () => {
		const accounts = [
			{ id: 'acc1', path: 'Groceries' },
			{ id: 'acc2', path: 'Utilities' },
			{ id: 'acc3', path: 'Entertainment' }
		];
		const totals = new Map([
			['acc1', 500],
			['acc2', 200],
			['acc3', 100]
		]);

		const tree = buildCategoryTree(accounts, totals);

		expect(tree.length).toBe(3);
		expect(tree[0].name).toBe('Groceries'); // Highest total first
		expect(tree[0].total).toBe(500);
		expect(tree[1].name).toBe('Utilities');
		expect(tree[1].total).toBe(200);
		expect(tree[2].name).toBe('Entertainment');
		expect(tree[2].total).toBe(100);
	});

	it('builds hierarchical tree with parent rollups', () => {
		const accounts = [
			{ id: 'acc1', path: 'Utilities:Electric' },
			{ id: 'acc2', path: 'Utilities:Gas' },
			{ id: 'acc3', path: 'Food:Groceries' }
		];
		const totals = new Map([
			['acc1', 120],
			['acc2', 80],
			['acc3', 300]
		]);

		const tree = buildCategoryTree(accounts, totals);

		expect(tree.length).toBe(2); // Food and Utilities

		// Food should be first (300 > 200)
		const food = tree.find((n) => n.name === 'Food');
		expect(food).toBeDefined();
		expect(food!.total).toBe(300);
		expect(food!.children.length).toBe(1);
		expect(food!.children[0].name).toBe('Groceries');

		// Utilities should roll up 120 + 80 = 200
		const utilities = tree.find((n) => n.name === 'Utilities');
		expect(utilities).toBeDefined();
		expect(utilities!.total).toBe(200);
		expect(utilities!.children.length).toBe(2);
	});

	it('handles deeply nested categories', () => {
		const accounts = [
			{ id: 'acc1', path: 'Home:Utilities:Electric:Usage' },
			{ id: 'acc2', path: 'Home:Utilities:Electric:Fees' },
			{ id: 'acc3', path: 'Home:Utilities:Water' }
		];
		const totals = new Map([
			['acc1', 100],
			['acc2', 20],
			['acc3', 50]
		]);

		const tree = buildCategoryTree(accounts, totals);

		expect(tree.length).toBe(1);
		expect(tree[0].name).toBe('Home');
		expect(tree[0].total).toBe(170); // All rolled up

		const utilities = tree[0].children[0];
		expect(utilities.name).toBe('Utilities');
		expect(utilities.total).toBe(170);

		const electric = utilities.children.find((n) => n.name === 'Electric');
		expect(electric).toBeDefined();
		expect(electric!.total).toBe(120); // Usage + Fees
	});

	it('handles empty totals', () => {
		const accounts = [
			{ id: 'acc1', path: 'Groceries' },
			{ id: 'acc2', path: 'Utilities' }
		];
		const totals = new Map<string, number>(); // Empty

		const tree = buildCategoryTree(accounts, totals);

		expect(tree.length).toBe(2);
		expect(tree[0].total).toBe(0);
		expect(tree[1].total).toBe(0);
	});

	it('assigns virtual IDs to parent nodes', () => {
		const accounts = [
			{ id: 'acc1', path: 'Food:Groceries' },
			{ id: 'acc2', path: 'Food:Restaurants' }
		];
		const totals = new Map([
			['acc1', 100],
			['acc2', 50]
		]);

		const tree = buildCategoryTree(accounts, totals);

		expect(tree[0].id).toBe('virtual:Food');
		expect(tree[0].children[0].id).toBe('acc1'); // Groceries first (higher total)
		expect(tree[0].children[1].id).toBe('acc2');
	});
});

describe('buildMonthlyData', () => {
	it('groups expenses by top-level category per month', () => {
		const monthlyTotals = [
			{ accountId: 'acc1', month: '2026-01', total: 100 },
			{ accountId: 'acc2', month: '2026-01', total: 50 },
			{ accountId: 'acc1', month: '2026-02', total: 120 },
			{ accountId: 'acc2', month: '2026-02', total: 60 }
		];
		const accountPaths = new Map([
			['acc1', 'Food:Groceries'],
			['acc2', 'Utilities:Electric']
		]);

		const data = buildMonthlyData(monthlyTotals, accountPaths);

		expect(data.length).toBe(2);
		expect(data[0].month).toBe('2026-01');
		expect(data[0].total).toBe(150);
		expect(data[0].segments.length).toBe(2);

		expect(data[1].month).toBe('2026-02');
		expect(data[1].total).toBe(180);
	});

	it('rolls up sub-categories to top-level', () => {
		const monthlyTotals = [
			{ accountId: 'acc1', month: '2026-01', total: 100 },
			{ accountId: 'acc2', month: '2026-01', total: 80 },
			{ accountId: 'acc3', month: '2026-01', total: 50 }
		];
		const accountPaths = new Map([
			['acc1', 'Utilities:Electric'],
			['acc2', 'Utilities:Gas'],
			['acc3', 'Food:Groceries']
		]);

		const data = buildMonthlyData(monthlyTotals, accountPaths);

		expect(data.length).toBe(1);
		expect(data[0].segments.length).toBe(2); // Utilities and Food

		const utilities = data[0].segments.find((s) => s.label === 'Utilities');
		expect(utilities).toBeDefined();
		expect(utilities!.value).toBe(180); // 100 + 80

		const food = data[0].segments.find((s) => s.label === 'Food');
		expect(food).toBeDefined();
		expect(food!.value).toBe(50);
	});

	it('sorts segments by value descending', () => {
		const monthlyTotals = [
			{ accountId: 'acc1', month: '2026-01', total: 50 },
			{ accountId: 'acc2', month: '2026-01', total: 200 },
			{ accountId: 'acc3', month: '2026-01', total: 100 }
		];
		const accountPaths = new Map([
			['acc1', 'Entertainment'],
			['acc2', 'Utilities'],
			['acc3', 'Food']
		]);

		const data = buildMonthlyData(monthlyTotals, accountPaths);

		expect(data[0].segments[0].label).toBe('Utilities'); // 200
		expect(data[0].segments[1].label).toBe('Food'); // 100
		expect(data[0].segments[2].label).toBe('Entertainment'); // 50
	});

	it('handles months with no data for some categories', () => {
		const monthlyTotals = [
			{ accountId: 'acc1', month: '2026-01', total: 100 },
			{ accountId: 'acc2', month: '2026-02', total: 50 }
		];
		const accountPaths = new Map([
			['acc1', 'Food'],
			['acc2', 'Utilities']
		]);

		const data = buildMonthlyData(monthlyTotals, accountPaths);

		expect(data.length).toBe(2);

		// January only has Food
		expect(data[0].segments.length).toBe(1);
		expect(data[0].segments[0].label).toBe('Food');

		// February only has Utilities
		expect(data[1].segments.length).toBe(1);
		expect(data[1].segments[0].label).toBe('Utilities');
	});

	it('returns empty array for no data', () => {
		const data = buildMonthlyData([], new Map());
		expect(data.length).toBe(0);
	});
});

describe('Date range calculations', () => {
	it('calculates YTD range correctly', () => {
		const now = new Date(2026, 3, 19); // April 19, 2026
		const from = new Date(2026, 0, 1); // Jan 1, 2026

		expect(from.getFullYear()).toBe(2026);
		expect(from.getMonth()).toBe(0);
		expect(from.getDate()).toBe(1);

		// YTD should span Jan 1 to now
		const monthsSpanned = now.getMonth() - from.getMonth() + 1;
		expect(monthsSpanned).toBe(4); // Jan, Feb, Mar, Apr
	});

	it('calculates last year range correctly', () => {
		const from = new Date(2025, 0, 1);
		const to = new Date(2025, 11, 31, 23, 59, 59, 999);

		expect(from.getFullYear()).toBe(2025);
		expect(to.getFullYear()).toBe(2025);
		expect(to.getMonth()).toBe(11); // December
		expect(to.getDate()).toBe(31);
	});

	it('calculates last 6 months range correctly', () => {
		const now = new Date(2026, 3, 19); // April 19, 2026
		// Using the correct approach: create date directly at midnight
		const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

		expect(sixMonthsAgo.getFullYear()).toBe(2025);
		expect(sixMonthsAgo.getMonth()).toBe(9); // October
		expect(sixMonthsAgo.getDate()).toBe(1);
	});

	it('last X months from date starts at midnight to include first-of-month transactions', () => {
		// Simulate querying at 3:09 PM on April 20, 2026
		const now = new Date(2026, 3, 20, 15, 9, 51);

		// WRONG approach: copy date then setDate(1) - keeps the 3:09 PM time
		const wrongFrom = new Date(now);
		wrongFrom.setMonth(wrongFrom.getMonth() - 6);
		wrongFrom.setDate(1);
		expect(wrongFrom.getHours()).toBe(15); // Still 3 PM - would exclude midnight transactions!

		// CORRECT approach: create new date at midnight
		const correctFrom = new Date(now.getFullYear(), now.getMonth() - 6, 1);
		expect(correctFrom.getHours()).toBe(0);
		expect(correctFrom.getMinutes()).toBe(0);
		expect(correctFrom.getSeconds()).toBe(0);
		expect(correctFrom.getMilliseconds()).toBe(0);

		// A transaction at midnight on Oct 1 should be included
		const transactionDate = new Date(2025, 9, 1, 0, 0, 0); // Oct 1, 2025 midnight
		expect(transactionDate >= correctFrom).toBe(true);
		expect(transactionDate >= wrongFrom).toBe(false); // Would be excluded with wrong approach!
	});
});
