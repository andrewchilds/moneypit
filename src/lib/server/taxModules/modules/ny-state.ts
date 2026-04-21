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
	]
};
