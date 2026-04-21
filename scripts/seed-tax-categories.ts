#!/usr/bin/env npx tsx
/**
 * One-off script to seed standard US tax categories for self-employment
 * (Married Filing Jointly, NY State)
 *
 * Run: npx tsx scripts/seed-tax-categories.ts
 */

import { createTaxCategory } from '../src/lib/server/actions/taxCategories';

interface TaxCategory {
	name: string;
	schedule: string;
	description: string;
}

const categories: TaxCategory[] = [
	// Schedule C - Business Income/Expenses
	{ name: 'Advertising', schedule: 'Schedule C Line 8', description: 'Advertising and marketing expenses' },
	{ name: 'Car & Truck', schedule: 'Schedule C Line 9', description: 'Vehicle expenses for business use' },
	{ name: 'Commissions & Fees', schedule: 'Schedule C Line 10', description: 'Commissions and fees paid to others' },
	{ name: 'Contract Labor', schedule: 'Schedule C Line 11', description: 'Payments to contractors (1099)' },
	{ name: 'Depreciation', schedule: 'Schedule C Line 13', description: 'Depreciation of business assets' },
	{ name: 'Employee Benefits', schedule: 'Schedule C Line 14', description: 'Employee benefit programs' },
	{ name: 'Insurance (Business)', schedule: 'Schedule C Line 15', description: 'Business insurance premiums' },
	{ name: 'Interest (Mortgage)', schedule: 'Schedule C Line 16a', description: 'Mortgage interest on business property' },
	{ name: 'Interest (Other)', schedule: 'Schedule C Line 16b', description: 'Other business interest expenses' },
	{ name: 'Legal & Professional', schedule: 'Schedule C Line 17', description: 'Legal and professional services' },
	{ name: 'Office Expense', schedule: 'Schedule C Line 18', description: 'Office supplies and expenses' },
	{ name: 'Pension/Profit Sharing', schedule: 'Schedule C Line 19', description: 'Retirement plan contributions' },
	{ name: 'Rent (Vehicles/Equipment)', schedule: 'Schedule C Line 20a', description: 'Rent or lease of vehicles, machinery, equipment' },
	{ name: 'Rent (Other)', schedule: 'Schedule C Line 20b', description: 'Rent or lease of other business property' },
	{ name: 'Repairs & Maintenance', schedule: 'Schedule C Line 21', description: 'Repairs and maintenance' },
	{ name: 'Supplies', schedule: 'Schedule C Line 22', description: 'Supplies not included in cost of goods sold' },
	{ name: 'Taxes & Licenses', schedule: 'Schedule C Line 23', description: 'Business taxes and licenses' },
	{ name: 'Travel', schedule: 'Schedule C Line 24a', description: 'Business travel expenses' },
	{ name: 'Meals (Business)', schedule: 'Schedule C Line 24b', description: 'Business meals (50% deductible)' },
	{ name: 'Utilities', schedule: 'Schedule C Line 25', description: 'Utilities for business' },
	{ name: 'Wages', schedule: 'Schedule C Line 26', description: 'Wages paid to employees' },
	{ name: 'Home Office', schedule: 'Schedule C Line 30', description: 'Home office deduction (Form 8829)' },
	{ name: 'Other Business Expense', schedule: 'Schedule C Line 27a', description: 'Other deductible business expenses' },
	{ name: 'Business Income', schedule: 'Schedule C Line 1', description: 'Gross receipts or sales' },
	{ name: 'Returns & Allowances', schedule: 'Schedule C Line 2', description: 'Returns and allowances' },
	{ name: 'Cost of Goods Sold', schedule: 'Schedule C Line 4', description: 'Cost of goods sold' },

	// Schedule SE - Self-Employment Tax
	{ name: 'Self-Employment Tax', schedule: 'Schedule SE', description: 'Self-employment tax (Social Security & Medicare)' },

	// Schedule B - Interest and Dividends
	{ name: 'Interest Income', schedule: 'Schedule B / Form 1040 Line 2b', description: 'Interest income from banks, bonds, etc.' },
	{ name: 'Dividend Income', schedule: 'Schedule B / Form 1040 Line 3b', description: 'Ordinary and qualified dividend income' },

	// Schedule D - Capital Gains
	{ name: 'Capital Gains', schedule: 'Schedule D', description: 'Capital gains and losses from sales of assets' },

	// Schedule 1 - Adjustments to Income
	{ name: 'Self-Employed Health Insurance', schedule: 'Schedule 1 Line 17', description: 'Health insurance premiums (self-employed)' },
	{ name: 'SEP/SIMPLE/Qualified Plans', schedule: 'Schedule 1 Line 16', description: 'Self-employed retirement contributions' },
	{ name: 'SE Tax Deduction', schedule: 'Schedule 1 Line 15', description: 'Deductible part of self-employment tax' },
	{ name: 'Student Loan Interest', schedule: 'Schedule 1 Line 21', description: 'Student loan interest deduction' },
	{ name: 'Educator Expenses', schedule: 'Schedule 1 Line 11', description: 'Educator expenses' },
	{ name: 'HSA Contribution', schedule: 'Schedule 1 Line 13', description: 'Health Savings Account contributions' },

	// Schedule A - Itemized Deductions (if itemizing)
	{ name: 'Medical Expenses', schedule: 'Schedule A Line 1', description: 'Medical and dental expenses (above 7.5% AGI)' },
	{ name: 'State & Local Taxes (SALT)', schedule: 'Schedule A Line 5', description: 'State and local taxes (capped at $10k)' },
	{ name: 'Mortgage Interest (Personal)', schedule: 'Schedule A Line 8', description: 'Home mortgage interest' },
	{ name: 'Charitable Contributions', schedule: 'Schedule A Line 11', description: 'Charitable donations' },

	// NY State Specific
	{ name: 'NY State Tax', schedule: 'NY IT-201', description: 'New York State income tax' },
	{ name: 'NYC Tax', schedule: 'NYC-210', description: 'New York City income tax' },
	{ name: 'NY College Tuition Credit', schedule: 'NY IT-272', description: 'NY college tuition credit/deduction' },
	{ name: 'NY 529 Contribution', schedule: 'NY IT-201 Line 29', description: 'NY 529 plan contribution deduction' },

	// Other Common Categories
	{ name: 'Estimated Tax Payment', schedule: 'Form 1040-ES', description: 'Quarterly estimated tax payments' },
	{ name: 'Not Deductible', schedule: 'N/A', description: 'Personal expenses - not tax deductible' },
	{ name: 'Tax Exempt', schedule: 'N/A', description: 'Tax-exempt income (municipal bonds, etc.)' },
];

async function main() {
	console.log('Seeding tax categories...\n');

	let created = 0;
	for (const cat of categories) {
		try {
			await createTaxCategory({
				name: cat.name,
				scheduleRef: cat.schedule,
				description: cat.description
			});
			console.log(`Created: ${cat.name}`);
			created++;
		} catch (e) {
			console.log(`Skipped: ${cat.name} (${(e as Error).message})`);
		}
	}

	console.log(`\nDone! Created ${created} tax categories.`);
	process.exit(0);
}

main();
