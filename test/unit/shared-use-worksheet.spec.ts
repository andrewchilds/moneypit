import { describe, it, expect } from 'bun:test';
import { sharedUseWorksheet, homeOfficeWorksheet } from '$lib/server/taxModules/modules/us-schedule-c';
import { checkWorksheetClaims } from '$lib/server/actions/reports';
import { parseFactValue } from '$lib/server/actions/taxFacts';
import type { WorksheetInput } from '$lib/server/taxModules';

const accounts: WorksheetInput['accounts'] = [
	{ id: 'phone', path: 'Phone', type: 'EXPENSE', total: 2786.54 },
	{ id: 'net', path: 'Utilities:Internet', type: 'EXPENSE', total: 1079.88 },
	{ id: 'rent', path: 'Rent:Apt', type: 'EXPENSE', total: 24000 },
	{ id: 'sales', path: 'Sales', type: 'INCOME', total: 50000 }
];
const section = { income: 50000, expenses: 5000 };

const facts = {
	shared_use: true,
	shared_use_accounts: [
		{ id: 'phone', percent: 50 },
		{ id: 'net', percent: 40 }
	]
};

describe('shared-use worksheet', () => {
	it('takes the business-use percentage of each account onto Schedule C line 25', () => {
		const result = sharedUseWorksheet.compute({ facts, accounts, section });
		expect(result).not.toBeNull();
		// phone 50% of 2786.54 = 1393.27, internet 40% of 1079.88 = 431.95
		const allocations = result!.breakdown.filter((r) => r.kind === 'allocation');
		expect(allocations.map((r) => [r.label, r.amount, r.accountId, r.share])).toEqual([
			['Phone', 1393.27, 'phone', 0.5],
			['Utilities:Internet', 431.95, 'net', 0.4]
		]);
		expect(result!.breakdown.find((r) => r.kind === 'result')?.amount).toBe(1825.22);
		expect(result!.lines).toEqual([{ category: 'Utilities', amount: 1825.22 }]);
	});

	it('is not limited by the gross income of the business', () => {
		const result = sharedUseWorksheet.compute({ facts, accounts, section: { income: 100, expenses: 9000 } });
		expect(result!.lines[0].amount).toBe(1825.22);
		expect(result!.breakdown.some((r) => r.kind === 'limit' || r.kind === 'carryover')).toBe(false);
	});

	it('produces nothing when shared use is not claimed or nothing is listed', () => {
		expect(sharedUseWorksheet.compute({ facts: { ...facts, shared_use: false }, accounts, section })).toBeNull();
		expect(sharedUseWorksheet.compute({ facts: { shared_use: true }, accounts, section })).toBeNull();
		expect(sharedUseWorksheet.compute({ facts: { shared_use: true, shared_use_accounts: [] }, accounts, section })).toBeNull();
	});

	it('skips accounts that are not in the book and clamps the percentage', () => {
		const result = sharedUseWorksheet.compute({
			facts: { shared_use: true, shared_use_accounts: [{ id: 'gone', percent: 50 }, { id: 'phone', percent: 150 }] },
			accounts,
			section
		});
		expect(result!.breakdown.filter((r) => r.kind === 'allocation').length).toBe(1);
		expect(result!.lines[0].amount).toBe(2786.54);
	});

	it('parses account shares from the CLI form', () => {
		expect(parseFactValue('phone:50, net:40%', 'account_shares')).toEqual([
			{ id: 'phone', percent: 50 },
			{ id: 'net', percent: 40 }
		]);
		expect(() => parseFactValue('phone', 'account_shares')).toThrow();
		expect(() => parseFactValue('phone:abc', 'account_shares')).toThrow();
		expect(() => parseFactValue('phone:120', 'account_shares')).toThrow();
	});
});

describe('worksheet claim check', () => {
	const run = (worksheetId: string, name: string, businessName: string, result: ReturnType<typeof sharedUseWorksheet.compute>) => ({
		worksheetId,
		name,
		businessName,
		breakdown: result!.breakdown
	});
	const shared = (businessName: string, shares: { id: string; percent: number }[]) =>
		run('shared-use', 'Business use of shared expenses', businessName, sharedUseWorksheet.compute({ facts: { shared_use: true, shared_use_accounts: shares }, accounts, section }));
	const office = (businessName: string, ids: string[]) =>
		run('home-office', 'Business use of home', businessName, homeOfficeWorksheet.compute({ facts: { home_office: true, home_office_sqft: 130, home_total_sqft: 1300, home_office_accounts: ids }, accounts, section }));

	it('is quiet when each account is claimed once, or by one worksheet under 100% across businesses', () => {
		expect(checkWorksheetClaims([shared('Darla', [{ id: 'phone', percent: 50 }]), shared('Andrew', [{ id: 'phone', percent: 50 }])])).toEqual([]);
		expect(checkWorksheetClaims([office('Darla', ['rent']), office('Andrew', ['rent'])])).toEqual([]);
	});

	it('flags an account allocated by both the home office and shared-use worksheets', () => {
		const warnings = checkWorksheetClaims([shared('Darla', [{ id: 'net', percent: 40 }]), office('Darla', ['net', 'rent'])]);
		expect(warnings).toEqual([
			'Utilities:Internet is allocated by Business use of shared expenses (Darla) at 40% and Business use of home (Darla) at 10%; it is counted twice.'
		]);
	});

	it('flags shares that add up to more than the whole account across businesses', () => {
		const warnings = checkWorksheetClaims([shared('Darla', [{ id: 'phone', percent: 70 }]), shared('Andrew', [{ id: 'phone', percent: 50 }])]);
		expect(warnings).toEqual([
			'120% of Phone is claimed across Business use of shared expenses (Darla) 70%, Business use of shared expenses (Andrew) 50%; the shares add up to more than the whole account.'
		]);
	});
});
