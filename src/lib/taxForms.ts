/**
 * Known tax form types and their common boxes. Used to label document lines
 * and to guess which tax category a box maps to. Any form type and box is
 * allowed; these are conveniences, not constraints.
 *
 * `categoryHints` are regex sources tried in order against the names of the
 * book's tax categories; the first match becomes the line's category.
 */
export interface FormBoxPreset {
	box: string;
	label: string;
	categoryHints?: string[];
}

export interface FormPreset {
	name: string;
	boxes: FormBoxPreset[];
}

export const FORM_PRESETS: Record<string, FormPreset> = {
	'W-2': {
		name: 'Wage and Tax Statement',
		boxes: [
			{ box: '1', label: 'Wages, tips, other compensation', categoryHints: ['^wages', 'salary'] },
			{ box: '2', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] },
			{ box: '17', label: 'State income tax withheld', categoryHints: ['state tax withheld'] },
			{ box: '19', label: 'Local income tax withheld', categoryHints: ['city tax withheld'] }
		]
	},
	'1099-NEC': {
		name: 'Nonemployee Compensation',
		boxes: [
			{ box: '1', label: 'Nonemployee compensation', categoryHints: ['gross receipts', 'business income'] },
			{ box: '4', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] }
		]
	},
	'1099-K': {
		name: 'Payment Card and Third Party Network Transactions',
		boxes: [{ box: '1a', label: 'Gross amount of payment transactions', categoryHints: ['gross receipts', 'business income'] }]
	},
	'1099-INT': {
		name: 'Interest Income',
		boxes: [
			{ box: '1', label: 'Interest income', categoryHints: ['^interest income$', 'interest'] },
			{ box: '3', label: 'Interest on U.S. Savings Bonds and Treasury obligations', categoryHints: ['treasury', '^interest income$', 'interest'] },
			{ box: '4', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] },
			{ box: '8', label: 'Tax-exempt interest', categoryHints: ['tax exempt'] }
		]
	},
	'1099-DIV': {
		name: 'Dividends and Distributions',
		boxes: [
			{ box: '1a', label: 'Total ordinary dividends', categoryHints: ['dividend.*ordinary', '^dividend income$', 'dividend'] },
			{ box: '1b', label: 'Qualified dividends', categoryHints: ['dividend.*qualified'] },
			{ box: '2a', label: 'Total capital gain distributions', categoryHints: ['capital gains? - long term', '^capital gains$'] },
			{ box: '4', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] },
			{ box: '12', label: 'Exempt-interest dividends', categoryHints: ['tax exempt'] }
		]
	},
	'1099-B': {
		name: 'Proceeds From Broker Transactions',
		boxes: [
			{ box: 'ST', label: 'Short-term net gain or loss', categoryHints: ['capital gains? - short term', '^capital gains$'] },
			{ box: 'LT', label: 'Long-term net gain or loss', categoryHints: ['capital gains? - long term', '^capital gains$'] },
			{ box: '4', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] }
		]
	},
	'1099-R': {
		name: 'Distributions From Pensions, IRAs, etc.',
		boxes: [
			{ box: '1', label: 'Gross distribution' },
			{ box: '2a', label: 'Taxable amount', categoryHints: ['ira distribution', 'retirement distribution', 'pension'] },
			{ box: '4', label: 'Federal income tax withheld', categoryHints: ['federal.*withheld'] }
		]
	},
	'1099-G': {
		name: 'Certain Government Payments',
		boxes: [
			{ box: '1', label: 'Unemployment compensation', categoryHints: ['unemployment'] },
			{ box: '2', label: 'State or local income tax refund', categoryHints: ['state.*refund'] }
		]
	},
	'1098': {
		name: 'Mortgage Interest Statement',
		boxes: [
			{ box: '1', label: 'Mortgage interest received from borrower', categoryHints: ['mortgage interest'] },
			{ box: '5', label: 'Mortgage insurance premiums', categoryHints: ['mortgage insurance'] },
			{ box: '10', label: 'Real estate taxes paid from escrow', categoryHints: ['real estate tax', 'property tax', 'state & local tax'] }
		]
	},
	'1098-T': {
		name: 'Tuition Statement',
		boxes: [{ box: '1', label: 'Payments received for qualified tuition', categoryHints: ['tuition'] }]
	},
	'1095-A': {
		name: 'Health Insurance Marketplace Statement',
		boxes: [
			{ box: 'A', label: 'Monthly enrollment premiums (annual total)', categoryHints: ['self-employed health insurance', 'health insurance', 'medical'] },
			{ box: 'B', label: 'Second lowest cost silver plan premium (annual total)' },
			{ box: 'C', label: 'Advance payment of premium tax credit (annual total)' }
		]
	},
	'K-1': {
		name: 'Partner or Shareholder Share of Income',
		boxes: [
			{ box: '1', label: 'Ordinary business income (loss)' },
			{ box: '2', label: 'Net rental real estate income (loss)' }
		]
	}
};

export const FORM_TYPES = Object.keys(FORM_PRESETS);

export function normalizeFormType(formType: string): string {
	const trimmed = formType.trim().toUpperCase();
	// Accept "1099INT", "1099 INT", "w2"
	const match = trimmed.match(/^(1099|1098|1095)\s*-?\s*([A-Z]+)$/);
	if (match) return `${match[1]}-${match[2]}`;
	if (trimmed === 'W2') return 'W-2';
	if (trimmed === 'K1') return 'K-1';
	return trimmed;
}

export function getBoxPreset(formType: string, box: string): FormBoxPreset | undefined {
	return FORM_PRESETS[normalizeFormType(formType)]?.boxes.find((b) => b.box.toUpperCase() === box.trim().toUpperCase());
}
