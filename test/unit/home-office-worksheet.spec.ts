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
		const result = homeOfficeWorksheet.compute({ facts, accounts, section: { income: 50000, expenses: 5000 } });
		expect(result).not.toBeNull();
		// 200/1300 = 15.3846%: rent 3692.31, electric 200.00
		const allocations = result!.breakdown.filter((r) => r.kind === 'allocation');
		expect(allocations.map((r) => [r.label, r.amount])).toEqual([
			['Rent:Apt', 3692.31],
			['Utilities:Electric', 200]
		]);
		expect(result!.breakdown.find((r) => r.kind === 'subtotal')?.amount).toBe(3892.31);
		expect(result!.lines).toEqual([{ category: 'Home Office', amount: 3892.31 }]);
		expect(result!.breakdown.some((r) => r.kind === 'carryover')).toBe(false);
	});

	it('caps the deduction at gross income less other expenses and carries the rest over', () => {
		const result = homeOfficeWorksheet.compute({ facts, accounts, section: { income: 4000, expenses: 1500 } });
		expect(result!.breakdown.find((r) => r.kind === 'limit')?.amount).toBe(2500);
		expect(result!.lines[0].amount).toBe(2500);
		expect(result!.breakdown.find((r) => r.kind === 'carryover')?.amount).toBe(1392.31);
	});

	it('allows nothing when the business already shows a loss', () => {
		const result = homeOfficeWorksheet.compute({ facts, accounts, section: { income: 500, expenses: 7000 } });
		expect(result!.lines[0].amount).toBe(0);
		expect(result!.breakdown.find((r) => r.kind === 'carryover')?.amount).toBe(3892.31);
	});

	it('produces nothing when there is no home office', () => {
		expect(homeOfficeWorksheet.compute({ facts: { ...facts, home_office: false }, accounts, section: { income: 50000, expenses: 0 } })).toBeNull();
		expect(homeOfficeWorksheet.compute({ facts: {}, accounts, section: { income: 50000, expenses: 0 } })).toBeNull();
	});

	it('produces nothing without square footage', () => {
		expect(homeOfficeWorksheet.compute({ facts: { home_office: true, home_office_sqft: 200 }, accounts, section: { income: 1, expenses: 0 } })).toBeNull();
	});

	it('skips account ids that are not in the book', () => {
		const result = homeOfficeWorksheet.compute({
			facts: { ...facts, home_office_accounts: ['rent', 'gone'] },
			accounts,
			section: { income: 50000, expenses: 0 }
		});
		expect(result!.breakdown.filter((r) => r.kind === 'allocation').length).toBe(1);
		expect(result!.lines[0].amount).toBe(3692.31);
	});
});
