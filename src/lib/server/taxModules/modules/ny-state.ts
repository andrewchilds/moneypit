import type { TaxModule } from '../types';

export const nyState: TaxModule = {
	id: 'ny-state',
	name: 'NY State',
	description: 'New York State IT-201 categories',
	group: 'us-state',
	categories: [
		{ name: 'NY State Tax Withheld', scheduleRef: 'IT-201 Line 72', description: 'New York State tax withheld' },
		{ name: 'NY City Tax Withheld', scheduleRef: 'IT-201 Line 73', description: 'New York City tax withheld' },
		{ name: 'NY Estimated Tax Payments', scheduleRef: 'IT-201 Line 74', description: 'Estimated tax payments made' },
		{ name: 'College Tuition Credit', scheduleRef: 'IT-201 Line 68', description: 'NY college tuition credit/deduction' },
		{ name: '529 Contributions', scheduleRef: 'IT-201', description: 'Contributions to NY 529 plans' },
	],
	questions: [
		{
			key: 'ny_residency',
			prompt: 'New York State residency for the year',
			type: 'choice',
			options: [
				{ value: 'full_year', label: 'Full-year resident' },
				{ value: 'part_year', label: 'Part-year resident' },
				{ value: 'nonresident', label: 'Nonresident' }
			]
		},
		{ key: 'nyc_resident', prompt: 'New York City resident for the year?', type: 'boolean' },
		{ key: 'ny_extension_filed', prompt: 'Was a NY extension (IT-370) filed?', type: 'boolean' },
		{
			key: 'ny_estimated_payments',
			prompt: 'NY estimated tax payments made for this year (total)',
			type: 'amount'
		},
		{ key: 'ny_529_contributions', prompt: 'Contributions to a NY 529 plan', type: 'amount' }
	]
};
