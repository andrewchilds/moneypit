import type { TaxModule } from '../types';

export const form1120: TaxModule = {
	id: 'form-1120',
	name: 'Form 1120 - C Corporation',
	description: 'Corporate income tax categories',
	group: 'corporate',
	categories: [
		// Income
		{ name: 'Gross Receipts', scheduleRef: 'Form 1120 Line 1a', description: 'Gross receipts or sales' },
		{ name: 'Cost of Goods Sold', scheduleRef: 'Form 1120 Line 2', description: 'Cost of goods sold' },
		{ name: 'Dividends Received', scheduleRef: 'Form 1120 Line 4', description: 'Dividends' },
		{ name: 'Interest Income', scheduleRef: 'Form 1120 Line 5', description: 'Interest' },
		{ name: 'Gross Rents', scheduleRef: 'Form 1120 Line 6', description: 'Gross rents' },
		{ name: 'Gross Royalties', scheduleRef: 'Form 1120 Line 7', description: 'Gross royalties' },
		{ name: 'Capital Gain Net Income', scheduleRef: 'Form 1120 Line 8', description: 'Capital gain net income' },
		{ name: 'Other Income', scheduleRef: 'Form 1120 Line 10', description: 'Other income' },
		// Deductions
		{ name: 'Compensation of Officers', scheduleRef: 'Form 1120 Line 12', description: 'Compensation of officers' },
		{ name: 'Salaries & Wages', scheduleRef: 'Form 1120 Line 13', description: 'Salaries and wages' },
		{ name: 'Repairs & Maintenance', scheduleRef: 'Form 1120 Line 14', description: 'Repairs and maintenance' },
		{ name: 'Bad Debts', scheduleRef: 'Form 1120 Line 15', description: 'Bad debts' },
		{ name: 'Rents', scheduleRef: 'Form 1120 Line 16', description: 'Rents' },
		{ name: 'Taxes & Licenses', scheduleRef: 'Form 1120 Line 17', description: 'Taxes and licenses' },
		{ name: 'Interest Expense', scheduleRef: 'Form 1120 Line 18', description: 'Interest' },
		{ name: 'Charitable Contributions', scheduleRef: 'Form 1120 Line 19', description: 'Charitable contributions' },
		{ name: 'Depreciation', scheduleRef: 'Form 1120 Line 20', description: 'Depreciation' },
		{ name: 'Depletion', scheduleRef: 'Form 1120 Line 21', description: 'Depletion' },
		{ name: 'Advertising', scheduleRef: 'Form 1120 Line 22', description: 'Advertising' },
		{ name: 'Pension & Profit Sharing', scheduleRef: 'Form 1120 Line 23', description: 'Pension, profit-sharing, etc., plans' },
		{ name: 'Employee Benefits', scheduleRef: 'Form 1120 Line 24', description: 'Employee benefit programs' },
		{ name: 'Other Deductions', scheduleRef: 'Form 1120 Line 26', description: 'Other deductions' },
	]
};
