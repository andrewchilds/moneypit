import { describe, it, expect } from 'bun:test';
import { homeOfficeWorksheet } from '$lib/server/taxModules/modules/us-schedule-c';
import type { WorksheetInput } from '$lib/server/taxModules';

const accounts: WorksheetInput['accounts'] = [
	{ id: 'rent', path: 'Rent:Apt', type: 'EXPENSE', total: 24000 },
	{ id: 'elec', path: 'Utilities:Electric', type: 'EXPENSE', total: 1300 },
	{ id: 'food', path: 'Groceries', type: 'EXPENSE', total: 6000 },
	{ id: 'sales', path: 'Sales', type: 'INCOME', total: 50000 }
];

const facts = {
	home_office: true,
	home_office_sqft: 200,
	home_total_sqft: 1300,
	home_office_accounts: ['rent', 'elec']
};

describe('home office worksheet', () => {
	it('allocates each account by the office share of the home', () => {
		const result = homeOfficeWorksheet.compute({ facts, accounts, shares: [], section: { income: 50000, expenses: 5000 } });
		expect(result).not.toBeNull();
		// 200/1300 = 15.38% as Form 8829 prints it: rent 3691.20, electric 199.94, 25,300 × 15.38% = 3891.14
		const allocations = result!.breakdown.filter((r) => r.kind === 'allocation');
		expect(allocations.map((r) => [r.label, r.amount])).toEqual([
			['Rent:Apt', 3691.2],
			['Utilities:Electric', 199.94]
		]);
		expect(allocations.map((r) => r.base)).toEqual([24000, 1300]);
		expect(result!.breakdown.find((r) => r.label === 'Office share of home expenses')?.amount).toBe(3891.14);
		expect(result!.breakdown.find((r) => r.label === 'Allowable home expenses')?.amount).toBe(3891.14);
		expect(result!.lines).toEqual([{ category: 'Home Office', amount: 3891.14 }]);
		expect(result!.breakdown.some((r) => r.kind === 'carryover')).toBe(false);
	});

	it('caps the deduction at gross income less other expenses and carries the rest over', () => {
		const result = homeOfficeWorksheet.compute({ facts, accounts, shares: [], section: { income: 4000, expenses: 1500 } });
		expect(result!.breakdown.find((r) => r.kind === 'limit')?.amount).toBe(2500);
		expect(result!.lines[0].amount).toBe(2500);
		expect(result!.breakdown.find((r) => r.kind === 'carryover')?.amount).toBe(1391.14);
	});

	it('deducts last year’s carryover under the same limit', () => {
		const withCarryover = { ...facts, home_office_carryover: 1392.31 };
		// Room for it all: 3,891.14 allocated plus 1,392.31 carried over
		const full = homeOfficeWorksheet.compute({ facts: withCarryover, accounts, shares: [], section: { income: 50000, expenses: 5000 } });
		expect(full!.breakdown.find((r) => r.label.startsWith('Operating expenses carried over'))?.amount).toBe(1392.31);
		expect(full!.breakdown.find((r) => r.label === 'Allowable home expenses')?.amount).toBe(5283.45);
		expect(full!.lines[0].amount).toBe(5283.45);
		expect(full!.breakdown.some((r) => r.kind === 'carryover')).toBe(false);
		// Limited again: 4,000 allowed, the rest carries to next year
		const limited = homeOfficeWorksheet.compute({ facts: withCarryover, accounts, shares: [], section: { income: 4000, expenses: 0 } });
		expect(limited!.lines[0].amount).toBe(4000);
		expect(limited!.breakdown.find((r) => r.kind === 'carryover')?.amount).toBe(1283.45);
	});

	it('allows nothing when the business already shows a loss', () => {
		const result = homeOfficeWorksheet.compute({ facts, accounts, shares: [], section: { income: 500, expenses: 7000 } });
		expect(result!.lines[0].amount).toBe(0);
		expect(result!.breakdown.find((r) => r.kind === 'carryover')?.amount).toBe(3891.14);
	});

	it('produces nothing when there is no home office', () => {
		expect(homeOfficeWorksheet.compute({ facts: { ...facts, home_office: false }, accounts, shares: [], section: { income: 50000, expenses: 0 } })).toBeNull();
		expect(homeOfficeWorksheet.compute({ facts: {}, accounts, shares: [], section: { income: 50000, expenses: 0 } })).toBeNull();
	});

	it('produces nothing without square footage', () => {
		expect(homeOfficeWorksheet.compute({ facts: { home_office: true, home_office_sqft: 200 }, accounts, shares: [], section: { income: 1, expenses: 0 } })).toBeNull();
	});

	it('skips account ids that are not in the book', () => {
		const result = homeOfficeWorksheet.compute({
			facts: { ...facts, home_office_accounts: ['rent', 'gone'] },
			accounts,
			shares: [],
			section: { income: 50000, expenses: 0 }
		});
		expect(result!.breakdown.filter((r) => r.kind === 'allocation').length).toBe(1);
		expect(result!.lines[0].amount).toBe(3691.2);
	});
});
