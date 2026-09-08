import type { TaxModule } from '../types';

export const caState: TaxModule = {
	id: 'ca-state',
	name: 'CA State',
	description: 'California FTB 540 categories',
	group: 'us-state',
	categories: [
		// Withholding and Payments
		{ name: 'CA State Tax Withheld', scheduleRef: 'CA 540 Line 71', description: 'California state tax withheld from wages' },
		{ name: 'CA Estimated Tax Payments', scheduleRef: 'CA 540 Line 72', description: 'Estimated tax payments made' },
		{ name: 'CA Real Estate Withholding', scheduleRef: 'CA 540 Line 73', description: 'Real estate and other withholding' },
		// Adjustments to Income (Schedule CA)
		{ name: 'CA Student Loan Interest', scheduleRef: 'Schedule CA Line 20', description: 'Student loan interest deduction (CA adjustment)' },
		{ name: 'CA IRA Deduction', scheduleRef: 'Schedule CA Line 19', description: 'IRA deduction (CA adjustment)' },
		{ name: 'CA HSA Deduction', scheduleRef: 'Schedule CA Line 12', description: 'HSA deduction - taxable in CA' },
		// Credits
		{ name: 'CA Renter Credit', scheduleRef: 'CA 540 Line 46', description: 'Nonrefundable renter\'s credit' },
		{ name: 'CA Child Care Credit', scheduleRef: 'CA 540 Line 40', description: 'Child and dependent care expenses credit' },
		{ name: 'CA EITC', scheduleRef: 'CA 540 Line 75', description: 'California Earned Income Tax Credit' },
		{ name: 'CA Young Child Credit', scheduleRef: 'CA 540 Line 76', description: 'Young Child Tax Credit' },
		// 529 Plans
		{ name: 'CA 529 Contributions', scheduleRef: 'Schedule CA', description: 'Contributions to CA ScholarShare 529 (no state deduction, but tracked)' },
		// Mental Health Services Tax (additional tax for high earners)
		{ name: 'CA Mental Health Tax', scheduleRef: 'CA 540 Line 62', description: 'Mental Health Services Tax (1% on income over $1M)' },
		// SDI
		{ name: 'CA SDI Withheld', scheduleRef: 'CA 540 Line 74', description: 'State Disability Insurance withheld (excess may be refundable)' },
	],
	questions: [
		{
			key: 'ca_residency',
			prompt: 'California residency for the year',
			type: 'choice',
			options: [
				{ value: 'full_year', label: 'Full-year resident' },
				{ value: 'part_year', label: 'Part-year resident' },
				{ value: 'nonresident', label: 'Nonresident' }
			]
		},
		{ key: 'ca_extension_payment', prompt: 'Amount paid with a CA extension (FTB 3519)', type: 'amount' }
	]
};
