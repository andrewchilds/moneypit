import type { TaxModule } from '../types';

export const usPersonalBase: TaxModule = {
	id: 'us-personal-base',
	name: 'US Personal - Base',
	description: 'Schedule A, B, D basics for personal tax filing',
	group: 'us-federal',
	categories: [
		// Schedule A - Itemized Deductions
		{ name: 'Medical Expenses', scheduleRef: 'Schedule A Line 1', description: 'Medical and dental expenses' },
		{ name: 'State & Local Taxes', scheduleRef: 'Schedule A Line 5a', description: 'State and local income or sales taxes' },
		{ name: 'Real Estate Taxes', scheduleRef: 'Schedule A Line 5b', description: 'Property taxes' },
		{ name: 'Mortgage Interest', scheduleRef: 'Schedule A Line 8a', description: 'Home mortgage interest' },
		{ name: 'Charitable Donations - Cash', scheduleRef: 'Schedule A Line 11', description: 'Cash contributions to charity' },
		{ name: 'Charitable Donations - Non-Cash', scheduleRef: 'Schedule A Line 12', description: 'Non-cash contributions to charity' },
		// Schedule B - Interest and Dividends
		{ name: 'Interest Income', scheduleRef: 'Schedule B Line 1', description: 'Interest from banks, bonds, etc.' },
		{ name: 'Dividend Income - Qualified', scheduleRef: 'Schedule B Line 5', description: 'Qualified dividends' },
		{ name: 'Dividend Income - Ordinary', scheduleRef: 'Schedule B Line 6', description: 'Ordinary dividends' },
		// Schedule D - Capital Gains
		{ name: 'Capital Gains - Short Term', scheduleRef: 'Schedule D Line 1', description: 'Short-term capital gains (held < 1 year)' },
		{ name: 'Capital Gains - Long Term', scheduleRef: 'Schedule D Line 8', description: 'Long-term capital gains (held >= 1 year)' },
		// Non-deductible
		{ name: 'Not Deductible', scheduleRef: 'N/A', description: 'Personal expenses - not tax deductible' },
		{ name: 'Tax Exempt', scheduleRef: 'N/A', description: 'Tax-exempt income (municipal bonds, etc.)' },
	]
};
