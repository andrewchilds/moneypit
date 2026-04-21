import type { TaxModule } from '../types';

export const njState: TaxModule = {
	id: 'nj-state',
	name: 'NJ State',
	description: 'New Jersey NJ-1040 categories',
	group: 'us-state',
	categories: [
		{ name: 'NJ State Tax Withheld', scheduleRef: 'NJ-1040 Line 49', description: 'New Jersey State tax withheld' },
		{ name: 'NJ Estimated Tax Payments', scheduleRef: 'NJ-1040 Line 50', description: 'Estimated tax payments made' },
		{ name: 'NJ Property Tax Deduction', scheduleRef: 'NJ-1040 Line 38', description: 'Property tax deduction/credit' },
	]
};
