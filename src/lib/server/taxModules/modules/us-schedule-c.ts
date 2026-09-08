import type { TaxModule } from '../types';

export const usScheduleC: TaxModule = {
	id: 'us-schedule-c',
	name: 'US Schedule C - Self Employment',
	description: 'Business income and expenses for sole proprietors',
	group: 'us-federal',
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
			key: 'sep_contribution',
			prompt: 'SEP or solo 401(k) employer contribution for this year',
			type: 'amount',
			description: 'Can be made up to the filing deadline including extensions'
		}
	],
	expectedDocuments: [
		{ formType: '1099-NEC', whenFact: { key: 'received_1099_nec', value: true }, reason: 'Client reported nonemployee compensation' },
		{ formType: '1099-K', whenFact: { key: 'received_1099_k', value: true }, reason: 'Payment processor reported card receipts' }
	]
};
