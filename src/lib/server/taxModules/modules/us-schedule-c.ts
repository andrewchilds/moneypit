import type { FactValue, TaxModule, TaxWorksheet, WorksheetBreakdownRow } from '../types';
import { asAccountIds, asAccountShares } from '../values';

const round2 = (n: number) => Math.round(n * 100) / 100;

function asNumber(value: FactValue | undefined): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/**
 * Form 8829, simplified: the office's share of whole-home costs, limited to
 * the business's gross income less its other expenses. No depreciation.
 */
export const homeOfficeWorksheet: TaxWorksheet = {
	id: 'home-office',
	name: 'Business use of home',
	description: 'Allocates whole-home costs to the office by square footage, limited to the gross income of the business (Form 8829)',
	facts: ['home_office', 'home_office_sqft', 'home_total_sqft', 'home_office_accounts'],
	compute({ facts, accounts, section }) {
		if (facts.home_office !== true) return null;
		const office = asNumber(facts.home_office_sqft);
		const total = asNumber(facts.home_total_sqft);
		if (office === null || total === null || office <= 0 || total <= 0) return null;

		const ratio = Math.min(1, office / total);
		const breakdown: WorksheetBreakdownRow[] = [
			{ label: 'Office square footage', amount: office, kind: 'input' },
			{ label: 'Total home square footage', amount: total, kind: 'input' },
			{ label: 'Business use percentage', detail: `${office} ÷ ${total}`, amount: round2(ratio * 100), kind: 'input' }
		];

		let allowable = 0;
		for (const id of asAccountIds(facts.home_office_accounts)) {
			const account = accounts.find((a) => a.id === id);
			if (!account) continue;
			const allocated = round2(account.total * ratio);
			allowable = round2(allowable + allocated);
			breakdown.push({
				label: account.path,
				detail: `${round2(ratio * 100)}% of ${account.total.toFixed(2)}`,
				amount: allocated,
				kind: 'allocation',
				accountId: account.id,
				share: ratio
			});
		}
		breakdown.push({ label: 'Allowable home expenses', amount: allowable, kind: 'subtotal' });

		const limit = Math.max(0, round2(section.income - section.expenses));
		breakdown.push({
			label: 'Gross income limit',
			detail: `${section.income.toFixed(2)} income less ${section.expenses.toFixed(2)} other expenses`,
			amount: limit,
			kind: 'limit'
		});

		const deduction = Math.min(allowable, limit);
		const carryover = round2(allowable - deduction);
		breakdown.push({ label: 'Home office deduction (Schedule C Line 30)', amount: deduction, kind: 'result' });
		if (carryover > 0) {
			breakdown.push({ label: 'Disallowed, carried over to next year', amount: carryover, kind: 'carryover' });
		}

		return { lines: [{ category: 'Home Office', amount: deduction }], breakdown };
	}
};

/**
 * Personal expense accounts used partly for the business (phone, internet):
 * the business-use percentage of each account's year total, on Schedule C
 * line 25. Unlike the home office, there is no gross income limit.
 */
export const sharedUseWorksheet: TaxWorksheet = {
	id: 'shared-use',
	name: 'Business use of shared expenses',
	description: 'The business-use percentage of personal accounts such as phone and internet, on Schedule C Line 25',
	facts: ['shared_use', 'shared_use_accounts'],
	compute({ facts, accounts }) {
		if (facts.shared_use !== true) return null;
		const shares = asAccountShares(facts.shared_use_accounts);
		if (shares.length === 0) return null;

		const breakdown: WorksheetBreakdownRow[] = [];
		let total = 0;
		for (const { id, percent } of shares) {
			const account = accounts.find((a) => a.id === id);
			if (!account) continue;
			const ratio = Math.min(1, Math.max(0, percent / 100));
			const allocated = round2(account.total * ratio);
			total = round2(total + allocated);
			breakdown.push({
				label: account.path,
				detail: `${round2(ratio * 100)}% of ${account.total.toFixed(2)}`,
				amount: allocated,
				kind: 'allocation',
				accountId: account.id,
				share: ratio
			});
		}
		if (breakdown.length === 0) return null;
		breakdown.push({ label: 'Business share of shared expenses (Schedule C Line 25)', amount: total, kind: 'result' });

		return { lines: [{ category: 'Utilities', amount: total }], breakdown };
	}
};

export const usScheduleC: TaxModule = {
	id: 'us-schedule-c',
	name: 'US Schedule C - Self Employment',
	description: 'Business income and expenses for sole proprietors',
	group: 'us-federal',
	perBusiness: true,
	categories: [
		// Income
		{ name: 'Gross Receipts', scheduleRef: 'Schedule C Line 1', description: 'Gross receipts or sales' },
		{ name: 'Returns & Allowances', scheduleRef: 'Schedule C Line 2', description: 'Returns and allowances' },
		{ name: 'Other Business Income', scheduleRef: 'Schedule C Line 6', description: 'Other income including federal and state fuel tax credit' },
		// Expenses
		{ name: 'Advertising', scheduleRef: 'Schedule C Line 8', description: 'Advertising expenses' },
		{ name: 'Car & Truck Expenses', scheduleRef: 'Schedule C Line 9', description: 'Car and truck expenses' },
		{ name: 'Commissions & Fees', scheduleRef: 'Schedule C Line 10', description: 'Commissions and fees' },
		{ name: 'Contract Labor', scheduleRef: 'Schedule C Line 11', description: 'Contract labor' },
		{ name: 'Depreciation', scheduleRef: 'Schedule C Line 13', description: 'Depreciation and Section 179 expense' },
		{ name: 'Employee Benefits', scheduleRef: 'Schedule C Line 14', description: 'Employee benefit programs' },
		{ name: 'Insurance', scheduleRef: 'Schedule C Line 15', description: 'Insurance (other than health)' },
		{ name: 'Interest - Mortgage', scheduleRef: 'Schedule C Line 16a', description: 'Interest on business mortgage' },
		{ name: 'Interest - Other', scheduleRef: 'Schedule C Line 16b', description: 'Other business interest' },
		{ name: 'Legal & Professional', scheduleRef: 'Schedule C Line 17', description: 'Legal and professional services' },
		{ name: 'Office Expense', scheduleRef: 'Schedule C Line 18', description: 'Office expenses' },
		{ name: 'Pension & Profit Sharing', scheduleRef: 'Schedule C Line 19', description: 'Pension and profit-sharing plans' },
		{ name: 'Rent - Vehicles & Equipment', scheduleRef: 'Schedule C Line 20a', description: 'Rent or lease of vehicles, machinery, and equipment' },
		{ name: 'Rent - Other', scheduleRef: 'Schedule C Line 20b', description: 'Rent or lease of other business property' },
		{ name: 'Repairs & Maintenance', scheduleRef: 'Schedule C Line 21', description: 'Repairs and maintenance' },
		{ name: 'Supplies', scheduleRef: 'Schedule C Line 22', description: 'Supplies' },
		{ name: 'Taxes & Licenses', scheduleRef: 'Schedule C Line 23', description: 'Taxes and licenses' },
		{ name: 'Travel', scheduleRef: 'Schedule C Line 24a', description: 'Travel expenses' },
		{ name: 'Meals (50%)', scheduleRef: 'Schedule C Line 24b', description: 'Deductible meals (50% limitation)' },
		{ name: 'Utilities', scheduleRef: 'Schedule C Line 25', description: 'Utilities' },
		{ name: 'Wages', scheduleRef: 'Schedule C Line 26', description: 'Wages paid to employees' },
		{ name: 'Home Office', scheduleRef: 'Schedule C Line 30', description: 'Business use of home expenses' },
		{ name: 'Other Expenses', scheduleRef: 'Schedule C Line 27', description: 'Other business expenses' },
	],
	questions: [
		{
			key: 'business_owner',
			prompt: 'Whose business is this Schedule C for?',
			type: 'choice',
			carryForward: true,
			options: [
				{ value: 'taxpayer', label: 'Taxpayer' },
				{ value: 'spouse', label: 'Spouse' }
			]
		},
		{
			key: 'business_description',
			prompt: 'Principal business or profession (Schedule C Line A)',
			type: 'text',
			carryForward: true
		},
		{
			key: 'business_code',
			prompt: 'Principal business code (Schedule C Line B)',
			type: 'text',
			carryForward: true
		},
		{
			key: 'accounting_method',
			prompt: 'Accounting method',
			type: 'choice',
			carryForward: true,
			options: [
				{ value: 'cash', label: 'Cash' },
				{ value: 'accrual', label: 'Accrual' }
			]
		},
		{
			key: 'received_1099_nec',
			prompt: 'Did any client issue a 1099-NEC for this year?',
			type: 'boolean'
		},
		{
			key: 'received_1099_k',
			prompt: 'Did a payment processor (Stripe, PayPal, etc.) issue a 1099-K?',
			type: 'boolean'
		},
		{
			key: 'home_office',
			prompt: 'Was part of the home used regularly and exclusively for business?',
			type: 'boolean'
		},
		{
			key: 'home_office_sqft',
			prompt: 'Home office square footage',
			type: 'number',
			dependsOn: { key: 'home_office', value: true }
		},
		{
			key: 'home_total_sqft',
			prompt: 'Total home square footage',
			type: 'number',
			dependsOn: { key: 'home_office', value: true }
		},
		{
			key: 'home_office_accounts',
			prompt: 'Whole-home expense accounts to allocate to the office',
			description: 'Rent, utilities, insurance: the office share of each year total goes on Schedule C Line 30',
			type: 'accounts',
			dependsOn: { key: 'home_office', value: true }
		},
		{
			key: 'shared_use',
			prompt: 'Were personal accounts such as phone or internet used partly for the business?',
			type: 'boolean'
		},
		{
			key: 'shared_use_accounts',
			prompt: 'Shared expense accounts and the business-use percentage of each',
			description:
				'Phone, internet: that share of each year total goes on Schedule C Line 25. Leave whole-home costs to the home office question so nothing is counted twice',
			type: 'account_shares',
			dependsOn: { key: 'shared_use', value: true }
		},
		{
			key: 'sep_contribution',
			prompt: 'SEP or solo 401(k) employer contribution for this year',
			type: 'amount',
			description: 'Can be made up to the filing deadline including extensions'
		}
	],
	expectedDocuments: [
		{ formType: '1099-NEC', whenFact: { key: 'received_1099_nec', value: true }, reason: 'Client reported nonemployee compensation' },
		{ formType: '1099-K', whenFact: { key: 'received_1099_k', value: true }, reason: 'Payment processor reported card receipts' }
	],
	// Shared-use first: its line 25 figure is one of the "other expenses"
	// the home office gross income limit is measured against
	worksheets: [sharedUseWorksheet, homeOfficeWorksheet]
};
