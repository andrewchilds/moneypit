import { describe, it, expect } from 'bun:test';
import { computeReturn, bracketTax, qualifiedDividendsAndCapitalGainTax, type ReturnInput, type BusinessInput } from '$lib/server/taxReturn/compute';
import { getTaxYearConstants } from '$lib/server/taxReturn/constants';
import { formatFormAmount, shouldPrint } from '$lib/server/taxReturn/pdf';

const c2025 = getTaxYearConstants(2025)!;
const c2024 = getTaxYearConstants(2024)!;

function business(overrides: Partial<BusinessInput> = {}): BusinessInput {
	return {
		id: 'b1',
		name: 'Consulting',
		unassigned: false,
		owner: 'taxpayer',
		description: 'Software consulting',
		code: '541511',
		accountingMethod: 'cash',
		income: [{ line: '1', category: 'Gross Receipts', amount: 100000 }],
		expenses: [
			{ line: '18', category: 'Office Expense', amount: 15000 },
			{ line: '17', category: 'Legal & Professional', amount: 5000 }
		],
		sepContribution: 0,
		...overrides
	};
}

function input(overrides: Partial<ReturnInput> = {}): ReturnInput {
	return {
		year: 2025,
		filingStatus: 'single',
		identity: {
			firstName: 'Ada',
			lastName: 'Lovelace',
			ssn: '123-45-6789',
			spouseFirstName: '',
			spouseLastName: '',
			spouseSsn: '',
			street: '1 Main St',
			apt: '',
			city: 'Hoboken',
			state: 'NJ',
			zip: '07030',
			occupation: 'Consultant',
			spouseOccupation: ''
		},
		dependents: 0,
		qualifyingChildren: 0,
		additionalDeductionBoxes: 0,
		wages: 0,
		socialSecurityWages: 0,
		medicareWages: 0,
		interest: { taxable: [], taxExempt: 0 },
		dividends: { ordinary: [], qualified: 0, ordinaryIncludesQualified: false },
		retirement: { gross: 0, taxable: 0 },
		capitalGains: { shortTerm: 0, longTerm: 0 },
		unemployment: 0,
		stateRefund: 0,
		scheduleENet: 0,
		schedule1: [],
		businesses: [],
		itemized: { medical: 0, stateLocalIncomeTaxes: 0, realEstateTaxes: 0, personalPropertyTaxes: 0, mortgageInterest: 0, charityCash: 0, charityNonCash: 0 },
		withholding: { w2: 0, forms1099: 0 },
		estimatedPayments: 0,
		extensionPayment: 0,
		notes: [],
		...overrides
	};
}

const line = (result: ReturnType<typeof computeReturn>, formId: string, line: string, businessId?: string) =>
	result.forms.find((f) => f.id === formId && (businessId === undefined || f.businessId === businessId))?.lines.find((l) => l.line === line)?.amount;

describe('bracketTax', () => {
	it('walks the 2025 single brackets', () => {
		// 10% of 11,925 + 12% of 36,550 + 22% of 1,525
		expect(bracketTax(50000, c2025, 'single')).toBe(5914);
		expect(bracketTax(0, c2025, 'single')).toBe(0);
		expect(bracketTax(11925, c2025, 'single')).toBe(1192.5);
	});

	it('uses the joint brackets for a surviving spouse', () => {
		expect(bracketTax(100000, c2025, 'qss')).toBe(bracketTax(100000, c2025, 'mfj'));
	});
});

describe('qualifiedDividendsAndCapitalGainTax', () => {
	it('taxes qualified dividends at 0% under the threshold', () => {
		const w = qualifiedDividendsAndCapitalGainTax(40000, 10000, 0, c2025, 'single');
		expect(w.atZero).toBe(10000);
		expect(w.atFifteen).toBe(0);
		// Bracket tax on the 30,000 of ordinary income only
		expect(w.tax).toBe(bracketTax(30000, c2025, 'single'));
		expect(w.tax).toBeLessThan(bracketTax(40000, c2025, 'single'));
	});

	it('splits gains across the 0% and 15% rates', () => {
		// 100,000 taxable, 60,000 of it long-term gain: 40,000 ordinary; 0% band 48,350 leaves 8,350 at 0%, rest at 15%
		const w = qualifiedDividendsAndCapitalGainTax(100000, 0, 60000, c2025, 'single');
		expect(w.atZero).toBe(8350);
		expect(w.atFifteen).toBe(51650);
		expect(w.tax).toBe(Math.round((bracketTax(40000, c2025, 'single') + 51650 * 0.15) * 100) / 100);
	});
});

describe('computeReturn', () => {
	it('runs a sole proprietor through Schedule C, SE, 8995 and the 1040', () => {
		const r = computeReturn(input({ businesses: [business()], estimatedPayments: 15000 }), c2025);
		expect(line(r, 'f1040sc', '7')).toBe(100000);
		expect(line(r, 'f1040sc', '28')).toBe(20000);
		expect(line(r, 'f1040sc', '31')).toBe(80000);
		// Schedule SE: 80,000 × 92.35% = 73,880; 12.4% + 2.9% of that
		expect(line(r, 'f1040sse', '4a')).toBe(73880);
		expect(line(r, 'f1040sse', '12')).toBe(11303.64);
		expect(line(r, 'f1040sse', '13')).toBe(5651.82);
		expect(line(r, 'f1040s1', '3')).toBe(80000);
		expect(line(r, 'f1040s1', '15')).toBe(5651.82);
		expect(r.summary.adjustedGrossIncome).toBe(74348.18);
		expect(r.summary.deduction).toBe(15750);
		expect(r.summary.deductionKind).toBe('standard');
		// QBI: 20% of 74,348.18 is more than 20% of taxable income before the deduction (58,598.18)
		expect(line(r, 'f8995', '5')).toBe(14869.64);
		expect(line(r, 'f8995', '14')).toBe(11719.64);
		expect(r.summary.qbiDeduction).toBe(11719.64);
		expect(r.summary.taxableIncome).toBe(46878.54);
		expect(r.summary.incomeTax).toBe(bracketTax(46878.54, c2025, 'single'));
		expect(r.summary.selfEmploymentTax).toBe(11303.64);
		expect(line(r, 'f1040s2', '21')).toBe(11303.64);
		expect(r.summary.totalTax).toBe(Math.round((5386.92 + 11303.64) * 100) / 100);
		expect(r.summary.totalPayments).toBe(15000);
		expect(r.summary.amountOwed).toBe(1690.56);
		expect(r.summary.refund).toBe(0);
		expect(r.forms.map((f) => f.id)).toEqual(['f1040', 'f1040s1', 'f1040s2', 'f1040sc', 'f1040sse', 'f8995']);
		expect(r.forms.find((f) => f.id === 'f1040')!.checks).toContain('status:single');
		expect(r.forms.find((f) => f.id === 'f1040sc')!.checks).toContain('method:cash');
	});

	it('halves meals and maps old line 27 to 27b', () => {
		const r = computeReturn(
			input({
				businesses: [
					business({
						expenses: [
							{ line: '24b', category: 'Meals (50%)', amount: 1000 },
							{ line: '27', category: 'Other Expenses', amount: 300 }
						]
					})
				]
			}),
			c2025
		);
		expect(line(r, 'f1040sc', '24b')).toBe(500);
		expect(line(r, 'f1040sc', '27b')).toBe(300);
		expect(line(r, 'f1040sc', '28')).toBe(800);
		expect(r.warnings.some((w) => w.includes('meals'))).toBe(true);
	});

	it('keeps the home office off line 28 and on line 30', () => {
		const r = computeReturn(
			input({ businesses: [business({ expenses: [{ line: '30', category: 'Home Office', amount: 2400 }] })] }),
			c2025
		);
		expect(line(r, 'f1040sc', '28')).toBe(0);
		expect(line(r, 'f1040sc', '30')).toBe(2400);
		expect(line(r, 'f1040sc', '31')).toBe(97600);
	});

	it('files one Schedule C per business and one Schedule SE per owner', () => {
		const r = computeReturn(
			input({
				businesses: [
					business(),
					business({ id: 'b2', name: 'Spouse shop', owner: 'spouse', income: [{ line: '1', category: 'Gross Receipts', amount: 10000 }], expenses: [] })
				]
			}),
			c2025
		);
		expect(r.forms.filter((f) => f.id === 'f1040sc').length).toBe(2);
		expect(r.forms.filter((f) => f.id === 'f1040sse').length).toBe(2);
		expect(line(r, 'f1040s1', '3')).toBe(90000);
		expect(line(r, 'f8995', '2')).toBeCloseTo(90000 - line(r, 'f1040s1', '15')!, 1);
	});

	it('skips Schedule SE under the minimum and shows a W-2 refund', () => {
		const r = computeReturn(
			input({
				wages: 60000,
				socialSecurityWages: 60000,
				medicareWages: 60000,
				withholding: { w2: 9000, forms1099: 0 },
				businesses: [business({ income: [{ line: '1', category: 'Gross Receipts', amount: 300 }], expenses: [] })]
			}),
			c2025
		);
		expect(r.forms.some((f) => f.id === 'f1040sse')).toBe(false);
		expect(r.summary.selfEmploymentTax).toBe(0);
		// Taxable 60,300 − 15,750 = 44,550, less the QBI deduction of 60
		expect(r.summary.qbiDeduction).toBe(60);
		expect(r.summary.taxableIncome).toBe(44490);
		expect(r.summary.incomeTax).toBe(bracketTax(44490, c2025, 'single'));
		expect(r.summary.refund).toBe(Math.round((9000 - bracketTax(44490, c2025, 'single')) * 100) / 100);
		expect(r.summary.amountOwed).toBe(0);
	});

	it('itemizes when Schedule A beats the standard deduction, with the SALT cap', () => {
		const r = computeReturn(
			input({
				wages: 150000,
				itemized: { medical: 0, stateLocalIncomeTaxes: 30000, realEstateTaxes: 15000, personalPropertyTaxes: 0, mortgageInterest: 12000, charityCash: 1000, charityNonCash: 0 }
			}),
			c2025
		);
		expect(line(r, 'f1040sa', '5d')).toBe(45000);
		expect(line(r, 'f1040sa', '5e')).toBe(40000);
		expect(line(r, 'f1040sa', '17')).toBe(53000);
		expect(r.summary.deductionKind).toBe('itemized');
		expect(r.summary.deduction).toBe(53000);
		expect(r.forms.some((f) => f.id === 'f1040sa')).toBe(true);
	});

	it('phases the SALT cap down above the 2025 income threshold', () => {
		const r = computeReturn(
			input({
				filingStatus: 'mfj',
				wages: 600000,
				itemized: { medical: 0, stateLocalIncomeTaxes: 50000, realEstateTaxes: 0, personalPropertyTaxes: 0, mortgageInterest: 40000, charityCash: 0, charityNonCash: 0 }
			}),
			c2025
		);
		// 40,000 less 30% of the 100,000 over 500,000 lands on the 10,000 floor
		expect(line(r, 'f1040sa', '5e')).toBe(10000);
		expect(line(r, 'f1040sa', '17')).toBe(50000);
		expect(r.summary.deductionKind).toBe('itemized');
	});

	it('uses the standard deduction when itemizing would be smaller and adds the age boxes', () => {
		const r = computeReturn(
			input({
				filingStatus: 'mfj',
				additionalDeductionBoxes: 2,
				wages: 80000,
				itemized: { medical: 0, stateLocalIncomeTaxes: 5000, realEstateTaxes: 0, personalPropertyTaxes: 0, mortgageInterest: 0, charityCash: 0, charityNonCash: 0 }
			}),
			c2025
		);
		expect(r.summary.deduction).toBe(31500 + 2 * 1600);
		expect(r.forms.some((f) => f.id === 'f1040sa')).toBe(false);
		expect(r.forms.find((f) => f.id === 'f1040')!.checks).toEqual(['status:mfj', 'age-or-blind:0', 'age-or-blind:1']);
	});

	it('limits a net capital loss and carries interest and dividends to Schedule B', () => {
		const r = computeReturn(
			input({
				wages: 50000,
				interest: { taxable: [{ name: 'Ally', amount: 400 }, { name: 'Marcus', amount: 250.5 }], taxExempt: 100 },
				dividends: { ordinary: [{ name: 'Vanguard', amount: 2000 }], qualified: 1500, ordinaryIncludesQualified: true },
				capitalGains: { shortTerm: -5000, longTerm: 500 }
			}),
			c2025
		);
		expect(line(r, 'f1040', '2a')).toBe(100);
		expect(line(r, 'f1040', '2b')).toBe(650.5);
		expect(line(r, 'f1040', '3a')).toBe(1500);
		expect(line(r, 'f1040', '3b')).toBe(2000);
		expect(line(r, 'f1040sd', '16')).toBe(-4500);
		expect(line(r, 'f1040sd', '21')).toBe(-3000);
		expect(line(r, 'f1040', '7')).toBe(-3000);
		expect(line(r, 'f1040', '9')).toBe(50000 + 650.5 + 2000 - 3000);
		expect(line(r, 'f1040sb', '1.amount.2')).toBe(250.5);
		expect(line(r, 'f1040sb', '4')).toBe(650.5);
		expect(line(r, 'f1040sb', '6')).toBe(2000);
		expect(r.warnings.some((w) => w.includes('carries forward'))).toBe(true);
	});

	it('adds qualified dividends to ordinary when the books split them', () => {
		const r = computeReturn(
			input({ dividends: { ordinary: [{ name: 'Dividends', amount: 800 }], qualified: 200, ordinaryIncludesQualified: false } }),
			c2025
		);
		expect(line(r, 'f1040', '3b')).toBe(1000);
		expect(line(r, 'f1040', '3a')).toBe(200);
	});

	it('computes the child tax credit with the phase-out and caps it at the tax', () => {
		const r = computeReturn(input({ filingStatus: 'mfj', wages: 410000, medicareWages: 410000, dependents: 3, qualifyingChildren: 2 }), c2025);
		// 2 × 2,200 + 1 × 500 = 4,900, less 50 per 1,000 over 400,000 (AGI 410,000 → 500)
		expect(line(r, 'f1040', '19')).toBe(4400);
		const small = computeReturn(input({ wages: 20000, dependents: 2, qualifyingChildren: 2 }), c2025);
		expect(line(small, 'f1040', '19')).toBe(line(small, 'f1040', '18'));
		expect(small.warnings.some((w) => w.includes('Schedule 8812'))).toBe(true);
	});

	it('applies the additional Medicare tax and net investment income tax over the thresholds', () => {
		const r = computeReturn(
			input({
				filingStatus: 'mfj',
				wages: 300000,
				socialSecurityWages: 300000,
				medicareWages: 300000,
				interest: { taxable: [{ name: 'Bank', amount: 20000 }], taxExempt: 0 }
			}),
			c2025
		);
		expect(line(r, 'f1040s2', '11')).toBe(450);
		// AGI 320,000 is 70,000 over; investment income 20,000 is smaller
		expect(line(r, 'f1040s2', '12')).toBe(760);
		expect(line(r, 'f1040s2', '21')).toBe(1210);
	});

	it('reduces the QBI deduction above the threshold', () => {
		const r = computeReturn(
			input({ wages: 200000, socialSecurityWages: 200000, medicareWages: 200000, businesses: [business({ income: [{ line: '1', category: 'Gross Receipts', amount: 60000 }], expenses: [] })] }),
			c2025
		);
		expect(r.summary.qbiDeduction).toBeLessThan(12000);
		expect(r.summary.qbiDeduction).toBeGreaterThan(0);
		expect(r.warnings.some((w) => w.includes('Form 8995-A'))).toBe(true);
	});

	it('puts an extension payment on Schedule 3', () => {
		const r = computeReturn(input({ wages: 50000, extensionPayment: 2000, estimatedPayments: 1000 }), c2025);
		expect(line(r, 'f1040s3', '10')).toBe(2000);
		expect(line(r, 'f1040', '31')).toBe(2000);
		expect(line(r, 'f1040', '26')).toBe(1000);
		expect(r.summary.totalPayments).toBe(3000);
	});

	it('takes Schedule 1 lines from categories that name them', () => {
		const r = computeReturn(input({ wages: 50000, schedule1: [{ line: '17', category: 'Self-Employed Health Insurance', amount: 6000 }, { line: '7', category: 'Unemployment', amount: 1000 }] }), c2025);
		expect(line(r, 'f1040s1', '17')).toBe(6000);
		expect(line(r, 'f1040s1', '26')).toBe(6000);
		expect(line(r, 'f1040s1', '7')).toBe(1000);
		expect(r.summary.adjustedGrossIncome).toBe(45000);
	});

	it('defaults to single with a warning when the filing status is unanswered', () => {
		const r = computeReturn(input({ filingStatus: null, wages: 10 }), c2025);
		expect(r.filingStatus).toBe('single');
		expect(r.warnings[0]).toContain('No filing status');
	});

	it('uses the 2024 tables for 2024', () => {
		const r = computeReturn(input({ year: 2024, wages: 50000 }), c2024);
		expect(r.summary.deduction).toBe(14600);
		expect(r.summary.incomeTax).toBe(bracketTax(35400, c2024, 'single'));
	});
});

describe('PDF formatting', () => {
	it('prints whole dollars and parenthesised losses', () => {
		expect(formatFormAmount(1234.56)).toBe('1,235');
		expect(formatFormAmount(-3000)).toBe('(3,000)');
		expect(formatFormAmount(0)).toBe('0');
	});

	it('leaves unused input lines blank but prints totals', () => {
		expect(shouldPrint({ line: '2a', label: '', amount: 0, kind: 'input' })).toBe(false);
		expect(shouldPrint({ line: '33', label: '', amount: 0, kind: 'total' })).toBe(true);
		expect(shouldPrint({ line: 'name', label: '', amount: null, text: '', kind: 'text' })).toBe(false);
		expect(shouldPrint({ line: 'name', label: '', amount: null, text: 'Ada', kind: 'text' })).toBe(true);
	});
});
