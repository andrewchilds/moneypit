import { describe, it, expect } from 'bun:test';
import { sharedUseWorksheet, homeOfficeWorksheet } from '$lib/server/taxModules/modules/us-schedule-c';
import { checkAccountClaims, type AccountClaim } from '$lib/server/actions/reports';
import type { WorksheetInput } from '$lib/server/taxModules';

const accounts: WorksheetInput['accounts'] = [
	{ id: 'phone', path: 'Phone', type: 'EXPENSE', total: 2786.54 },
	{ id: 'net', path: 'Utilities:Internet', type: 'EXPENSE', total: 1079.88 },
	{ id: 'rent', path: 'Rent:Apt', type: 'EXPENSE', total: 24000 },
	{ id: 'sales', path: 'Sales', type: 'INCOME', total: 50000 }
];
const section = { income: 50000, expenses: 5000 };

// Personal accounts attached to the business: the phone at 50%, internet at 40%
const shares = [
	{ id: 'phone', share: 0.5 },
	{ id: 'net', share: 0.4 }
];

describe('shared-use worksheet', () => {
	it('takes the business share of each attached personal account onto Schedule C line 25', () => {
		const result = sharedUseWorksheet.compute({ facts: {}, accounts, shares, section });
		expect(result).not.toBeNull();
		// phone 50% of 2786.54 = 1393.27, internet 40% of 1079.88 = 431.95
		const allocations = result!.breakdown.filter((r) => r.kind === 'allocation');
		// No share on the rows: the attachment is already the claim on the account
		expect(allocations.map((r) => [r.label, r.amount, r.accountId, r.share])).toEqual([
			['Phone', 1393.27, 'phone', undefined],
			['Utilities:Internet', 431.95, 'net', undefined]
		]);
		expect(result!.breakdown.find((r) => r.kind === 'result')?.amount).toBe(1825.22);
		expect(result!.lines).toEqual([{ category: 'Utilities', amount: 1825.22 }]);
	});

	it('is not limited by the gross income of the business', () => {
		const result = sharedUseWorksheet.compute({ facts: {}, accounts, shares, section: { income: 100, expenses: 9000 } });
		expect(result!.lines[0].amount).toBe(1825.22);
		expect(result!.breakdown.some((r) => r.kind === 'limit' || r.kind === 'carryover')).toBe(false);
	});

	it('produces nothing when no personal account is attached', () => {
		expect(sharedUseWorksheet.compute({ facts: {}, accounts, shares: [], section })).toBeNull();
	});

	it('skips accounts that are not in the book or not expenses, and clamps the share', () => {
		const result = sharedUseWorksheet.compute({
			facts: {},
			accounts,
			shares: [
				{ id: 'gone', share: 0.5 },
				{ id: 'sales', share: 1 },
				{ id: 'phone', share: 1.5 }
			],
			section
		});
		expect(result!.breakdown.filter((r) => r.kind === 'allocation').length).toBe(1);
		expect(result!.lines[0].amount).toBe(2786.54);
	});
});

describe('account claim check', () => {
	const link = (businessName: string, accountId: string, percent: number): AccountClaim => ({
		accountId,
		path: accounts.find((a) => a.id === accountId)!.path,
		businessName,
		share: percent / 100
	});
	const office = (businessName: string, ids: string[]) => ({
		worksheetId: 'home-office',
		name: 'Business use of home',
		businessName,
		breakdown: homeOfficeWorksheet.compute({
			facts: { home_office: true, home_office_sqft: 130, home_total_sqft: 1300, home_office_accounts: ids },
			accounts,
			shares: [],
			section
		})!.breakdown
	});

	it('is quiet when each account is claimed once, or by one kind of claim under 100% across businesses', () => {
		expect(checkAccountClaims([], [link('Darla', 'phone', 50), link('Andrew', 'phone', 50)])).toEqual([]);
		expect(checkAccountClaims([office('Darla', ['rent']), office('Andrew', ['rent'])])).toEqual([]);
		expect(checkAccountClaims([], [link('Darla', 'phone', 100)])).toEqual([]);
	});

	it('flags an account both attached to a business and allocated by the home office worksheet', () => {
		const warnings = checkAccountClaims([office('Darla', ['net', 'rent'])], [link('Darla', 'net', 40)]);
		expect(warnings).toEqual([
			'Utilities:Internet is allocated by Darla at 40% and Business use of home (Darla) at 10%; it is counted twice.'
		]);
	});

	it('flags shares that add up to more than the whole account across businesses', () => {
		const warnings = checkAccountClaims([], [link('Darla', 'phone', 70), link('Andrew', 'phone', 50)]);
		expect(warnings).toEqual(['120% of Phone is claimed across Darla 70%, Andrew 50%; the shares add up to more than the whole account.']);
	});
});
