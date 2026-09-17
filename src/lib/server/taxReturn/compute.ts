/**
 * A draft federal return computed from the figures the tax report already
 * has. Pure: everything comes in through `ReturnInput`, so it can be unit
 * tested, and every line on every form is listed with the math behind it.
 *
 * What is computed: Schedule C per business, Schedule SE, Form 8995 (the
 * simplified QBI deduction), Schedule 1, Schedule 2 (self-employment tax,
 * additional Medicare tax, net investment income tax), Schedule 3 (an
 * extension payment), Schedules A, B and D, Schedule 8812 (the child tax
 * credit and its refundable part), Schedule EIC and the earned income
 * credit, and Form 1040 through the refund or amount owed. What is not:
 * other credits, the alternative minimum tax, depreciation, carryovers from
 * prior years, and the other deductions on Schedule 1-A. Each gap that could
 * apply is listed in `warnings`.
 */

import { FILING_STATUS_LABELS, type FilingStatus, type TaxYearConstants } from './constants';

export type FormId = 'f1040' | 'f1040s1' | 'f1040s2' | 'f1040s3' | 'f1040sa' | 'f1040sb' | 'f1040sc' | 'f1040sd' | 'f1040sse' | 'f1040sei' | 'f1040s8' | 'f8995';

export interface PayerFigure {
	name: string;
	amount: number;
}

export interface ScheduleLineFigure {
	/** The line on the schedule, as written in the category's scheduleRef ("24b") */
	line: string;
	category: string;
	amount: number;
}

export interface BusinessInput {
	id: string | null;
	name: string | null;
	/** Accounts with Schedule C categories but no business */
	unassigned: boolean;
	owner: 'taxpayer' | 'spouse';
	description: string;
	code: string;
	accountingMethod: 'cash' | 'accrual' | null;
	income: ScheduleLineFigure[];
	expenses: ScheduleLineFigure[];
	sepContribution: number;
}

export interface ReturnIdentity {
	firstName: string;
	lastName: string;
	ssn: string;
	spouseFirstName: string;
	spouseLastName: string;
	spouseSsn: string;
	street: string;
	apt: string;
	city: string;
	state: string;
	zip: string;
	occupation: string;
	spouseOccupation: string;
}

export interface DependentInput {
	firstName: string;
	lastName: string;
	ssn: string;
	relationship: string;
	birthYear: number | null;
	/** Months lived with the taxpayer in the U.S. during the year */
	monthsLived: number | null;
	status: 'none' | 'student' | 'disabled';
}

export interface ReturnInput {
	year: number;
	filingStatus: FilingStatus | null;
	identity: ReturnIdentity;
	dependents: number;
	/** Dependents under 17 who qualify for the child tax credit */
	qualifyingChildren: number;
	/** Who the dependents are, as far as answered; may be shorter than `dependents` */
	dependentDetails: DependentInput[];
	/** Boxes checked on Form 1040 line 12d: you or your spouse 65 or older or blind */
	additionalDeductionBoxes: number;
	wages: number;
	socialSecurityWages: number;
	medicareWages: number;
	interest: { taxable: PayerFigure[]; taxExempt: number };
	dividends: {
		ordinary: PayerFigure[];
		qualified: number;
		/** True when the ordinary figure came from a 1099-DIV box 1a, which already includes box 1b */
		ordinaryIncludesQualified: boolean;
	};
	retirement: { gross: number; taxable: number };
	/** Net gains from sales, and capital gain distributions from funds (1099-DIV box 2a), which are long-term by law and go on Schedule D line 13 */
	capitalGains: { shortTerm: number; longTerm: number; distributions: number };
	unemployment: number;
	stateRefund: number;
	scheduleENet: number;
	/** Categories whose scheduleRef names a Schedule 1 line, by line */
	schedule1: ScheduleLineFigure[];
	businesses: BusinessInput[];
	itemized: {
		medical: number;
		stateLocalIncomeTaxes: number;
		realEstateTaxes: number;
		personalPropertyTaxes: number;
		mortgageInterest: number;
		charityCash: number;
		charityNonCash: number;
	};
	withholding: { w2: number; forms1099: number };
	estimatedPayments: number;
	extensionPayment: number;
	/** Things noticed while assembling the input, carried into the warnings */
	notes: string[];
}

export type LineKind = 'input' | 'computed' | 'total' | 'result' | 'text';

export interface ReturnLine {
	line: string;
	label: string;
	amount: number | null;
	text?: string;
	detail?: string;
	kind: LineKind;
}

export interface ReturnForm {
	id: FormId;
	/** "Schedule C", "Form 1040" */
	name: string;
	title: string;
	businessId: string | null;
	businessName: string | null;
	lines: ReturnLine[];
	/** Boxes to tick on the form, by key (filing status, accounting method) */
	checks: string[];
}

export interface ReturnSummary {
	totalIncome: number;
	adjustedGrossIncome: number;
	deduction: number;
	deductionKind: 'standard' | 'itemized';
	qbiDeduction: number;
	taxableIncome: number;
	incomeTax: number;
	selfEmploymentTax: number;
	totalTax: number;
	/** Earned income credit plus the additional child tax credit, counted in `totalPayments` */
	refundableCredits: number;
	totalPayments: number;
	refund: number;
	amountOwed: number;
	effectiveRate: number;
}

export interface ReturnComputation {
	year: number;
	filingStatus: FilingStatus;
	filingStatusLabel: string;
	forms: ReturnForm[];
	summary: ReturnSummary;
	warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (r: number) => `${round2(r * 100)}%`;
const sum = (ns: number[]) => round2(ns.reduce((a, b) => a + b, 0));

class FormBuilder {
	readonly form: ReturnForm;
	constructor(id: FormId, name: string, title: string, business: { id: string | null; name: string | null } = { id: null, name: null }) {
		this.form = { id, name, title, businessId: business.id, businessName: business.name, lines: [], checks: [] };
	}
	amount(line: string, label: string, amount: number, kind: LineKind = 'computed', detail?: string): number {
		this.form.lines.push({ line, label, amount: round2(amount), detail, kind });
		return round2(amount);
	}
	text(line: string, label: string, text: string): void {
		if (text) this.form.lines.push({ line, label, amount: null, text, kind: 'text' });
	}
	check(key: string, on = true): void {
		if (on) this.form.checks.push(key);
	}
	get(line: string): number {
		return this.form.lines.find((l) => l.line === line)?.amount ?? 0;
	}
}

/** Ordinary income tax from the bracket table */
export function bracketTax(taxable: number, constants: TaxYearConstants, status: FilingStatus): number {
	let tax = 0;
	let lower = 0;
	for (const bracket of constants.brackets[status]) {
		const upper = bracket.upTo ?? Infinity;
		if (taxable <= lower) break;
		tax += (Math.min(taxable, upper) - lower) * bracket.rate;
		lower = upper;
	}
	return round2(tax);
}

/**
 * The Qualified Dividends and Capital Gain Tax Worksheet from the Form 1040
 * instructions: preferential rates on qualified dividends and net long-term
 * gains, bracket rates on the rest, never more than bracket rates on it all.
 */
export function qualifiedDividendsAndCapitalGainTax(
	taxable: number,
	qualifiedDividends: number,
	netCapitalGain: number,
	constants: TaxYearConstants,
	status: FilingStatus
): { tax: number; preferential: number; atZero: number; atFifteen: number; atTwenty: number } {
	const rates = constants.capitalGains[status];
	const line4 = Math.max(0, qualifiedDividends) + Math.max(0, netCapitalGain);
	const line5 = Math.max(0, taxable - line4);
	const line7 = Math.min(taxable, rates.zeroUpTo);
	const line8 = Math.min(line5, line7);
	const line9 = Math.max(0, line7 - line8);
	const line10 = Math.min(taxable, line4);
	const line12 = Math.max(0, line10 - line9);
	const line14 = Math.min(taxable, rates.fifteenUpTo);
	const line15 = line5 + line9;
	const line16 = Math.max(0, line14 - line15);
	const line17 = Math.min(line12, line16);
	const line18 = line17 * 0.15;
	const line19 = line9 + line17;
	const line20 = Math.max(0, line10 - line19);
	const line21 = line20 * 0.2;
	const line22 = bracketTax(line5, constants, status);
	const line23 = line18 + line21 + line22;
	const line24 = bracketTax(taxable, constants, status);
	return {
		tax: round2(Math.min(line23, line24)),
		preferential: round2(line10),
		atZero: round2(line9),
		atFifteen: round2(line17),
		atTwenty: round2(line20)
	};
}

/** Age at the end of the tax year is under `age` */
function underAge(d: DependentInput, year: number, age: number): boolean {
	return d.birthYear !== null && year - d.birthYear < age;
}

/**
 * The earned income credit as the EIC table gives it: the credit is figured
 * at the midpoint of each $50 range of earned income, and phased out on the
 * larger of earned income or AGI. Eligibility beyond the investment income
 * limit and filing status is not checked.
 */
export function earnedIncomeCredit(
	earnedIncome: number,
	agi: number,
	qualifyingChildren: number,
	investmentIncome: number,
	constants: TaxYearConstants,
	status: FilingStatus
): { credit: number; detail: string } {
	const table = constants.earnedIncomeCredit;
	const row = table.byChildren[Math.min(qualifyingChildren, table.byChildren.length - 1)];
	const start = status === 'mfj' ? row.phaseOutStart.mfj : row.phaseOutStart.single;
	if (status === 'mfs') return { credit: 0, detail: 'Not computed for married filing separately (the separated-spouse exception is not checked)' };
	if (earnedIncome < 1) return { credit: 0, detail: 'No earned income' };
	if (investmentIncome > table.investmentIncomeLimit) {
		return { credit: 0, detail: `Investment income of ${money(investmentIncome)} is over the ${money(table.investmentIncomeLimit)} limit` };
	}
	const mid = (n: number) => Math.floor(n / 50) * 50 + 25;
	const phaseIn = Math.min(row.maxCredit, round2(Math.min(mid(earnedIncome), row.earnedIncomeAmount) * row.rate));
	const base = Math.max(earnedIncome, agi);
	const reduction = mid(base) > start ? round2((mid(base) - start) * row.phaseOutRate) : 0;
	const credit = Math.max(0, Math.round(phaseIn - reduction));
	const children = `${qualifyingChildren} qualifying child${qualifyingChildren === 1 ? '' : 'ren'}`;
	if (credit === 0) return { credit, detail: `${children}: earned income of ${money(base)} is past the phase-out for ${FILING_STATUS_LABELS[status].toLowerCase()}` };
	return {
		credit,
		detail: `${children}: ${pct(row.rate)} of earned income ${money(earnedIncome)} up to ${money(row.maxCredit)}${reduction ? `, less ${pct(row.phaseOutRate)} of the ${money(base)} over ${money(start)}` : ''}, from the EIC table`
	};
}

const SCHEDULE_C_EXPENSE_LINES = [
	['8', 'Advertising'],
	['9', 'Car and truck expenses'],
	['10', 'Commissions and fees'],
	['11', 'Contract labor'],
	['12', 'Depletion'],
	['13', 'Depreciation and section 179'],
	['14', 'Employee benefit programs'],
	['15', 'Insurance (other than health)'],
	['16a', 'Mortgage interest'],
	['16b', 'Other interest'],
	['17', 'Legal and professional services'],
	['18', 'Office expense'],
	['19', 'Pension and profit-sharing plans'],
	['20a', 'Rent or lease: vehicles, machinery, equipment'],
	['20b', 'Rent or lease: other business property'],
	['21', 'Repairs and maintenance'],
	['22', 'Supplies'],
	['23', 'Taxes and licenses'],
	['24a', 'Travel'],
	['24b', 'Deductible meals'],
	['25', 'Utilities'],
	['26', 'Wages'],
	['27a', 'Energy efficient commercial buildings deduction'],
	['27b', 'Other expenses']
] as const;

/** "Schedule C Line 27" was written before the form split line 27 in two */
const SCHEDULE_C_LINE_ALIASES: Record<string, string> = { '27': '27b', '20': '20b', '16': '16b', '24': '24a' };

function scheduleC(business: BusinessInput, warnings: string[]): FormBuilder {
	const name = business.unassigned ? 'no business assigned' : (business.name ?? 'Schedule C');
	const f = new FormBuilder('f1040sc', 'Schedule C', 'Profit or Loss From Business', { id: business.id, name: business.unassigned ? null : business.name });
	f.text('A', 'Principal business or profession', business.description);
	f.text('B', 'Principal business code', business.code);
	f.text('C', 'Business name', business.unassigned ? '' : (business.name ?? ''));
	if (business.accountingMethod) f.check(`method:${business.accountingMethod}`);
	f.check('materially-participated');

	const incomeOn = (line: string) => sum(business.income.filter((i) => i.line === line).map((i) => i.amount));
	const expensesOn = (line: string) => {
		const entries = business.expenses.filter((e) => (SCHEDULE_C_LINE_ALIASES[e.line] ?? e.line) === line);
		return { amount: sum(entries.map((e) => e.amount)), categories: entries.map((e) => e.category), entries };
	};
	const line1 = f.amount('1', 'Gross receipts or sales', incomeOn('1'), 'input');
	const line2 = f.amount('2', 'Returns and allowances', incomeOn('2'), 'input');
	const line3 = f.amount('3', 'Line 1 less line 2', line1 - line2);
	const cogs = expensesOn('4');
	const line4 = f.amount('4', 'Cost of goods sold', cogs.amount, 'input', cogs.categories.join(', ') || undefined);
	const line5 = f.amount('5', 'Gross profit', line3 - line4);
	const line6 = f.amount('6', 'Other income', incomeOn('6'), 'input');
	const line7 = f.amount('7', 'Gross income', line5 + line6, 'total');

	let line28 = 0;
	for (const [line, label] of SCHEDULE_C_EXPENSE_LINES) {
		const { amount, categories } = expensesOn(line);
		if (amount === 0) continue;
		let deductible = amount;
		let detail = categories.join(', ');
		if (line === '24b') {
			deductible = round2(amount * 0.5);
			detail = `50% of ${money(amount)} recorded`;
			warnings.push(`${name}: meals on Schedule C line 24b are half of the ${money(amount)} recorded, per the 50% limit.`);
		}
		f.amount(line, label, deductible, 'input', detail);
		line28 = round2(line28 + deductible);
	}
	const unknown = business.expenses.filter((e) => !SCHEDULE_C_EXPENSE_LINES.some(([l]) => l === (SCHEDULE_C_LINE_ALIASES[e.line] ?? e.line)) && e.line !== '30' && e.line !== '4');
	for (const e of unknown) {
		warnings.push(`${name}: ${e.category} (${money(e.amount)}) is on Schedule C line ${e.line}, which the computation does not know; it was left off.`);
	}
	f.amount('28', 'Total expenses before business use of home', line28, 'total');
	const line29 = f.amount('29', 'Tentative profit or loss', line7 - line28);
	const line30 = f.amount('30', 'Expenses for business use of home', expensesOn('30').amount, 'input');
	f.amount('31', 'Net profit or loss', line29 - line30, 'result');

	// Part V lists what is behind line 27b, one row per category (nine rows on the form)
	const other = expensesOn('27b');
	if (other.amount !== 0) {
		const rows = other.entries.length > 9 ? [...other.entries.slice(0, 8), { category: 'Other', amount: sum(other.entries.slice(8).map((e) => e.amount)) }] : other.entries;
		rows.forEach((e, i) => {
			f.text(`48.desc.${i + 1}`, `Other expense ${i + 1}`, e.category);
			f.amount(`48.amount.${i + 1}`, `Other expense ${i + 1}`, e.amount, 'input');
		});
		f.amount('48', 'Total other expenses (to line 27b)', other.amount, 'total');
	}
	return f;
}

function scheduleSE(
	owner: 'taxpayer' | 'spouse',
	netProfit: number,
	socialSecurityWages: number,
	constants: TaxYearConstants,
	warnings: string[]
): FormBuilder | null {
	const se = constants.selfEmployment;
	const f = new FormBuilder('f1040sse', 'Schedule SE', owner === 'spouse' ? 'Self-Employment Tax (spouse)' : 'Self-Employment Tax');
	const line2 = f.amount('2', 'Net profit or loss from Schedule C', netProfit, 'input');
	const line3 = f.amount('3', 'Combine lines 1a, 1b, and 2', line2);
	if (line3 <= 0) return null;
	const line4a = f.amount('4a', `Line 3 × ${pct(se.earningsFactor)}`, line3 * se.earningsFactor);
	if (line4a < se.minimumEarnings) {
		warnings.push(`Net earnings from self-employment are under $${se.minimumEarnings}, so no self-employment tax is due.`);
		return null;
	}
	const line4c = f.amount('4c', 'Net earnings from self-employment', line4a);
	const line6 = f.amount('6', 'Net earnings subject to tax', line4c);
	const line7 = f.amount('7', 'Maximum earnings subject to social security tax', se.socialSecurityWageBase, 'input');
	const line8a = f.amount('8a', 'Social security wages from W-2s', socialSecurityWages, 'input');
	const line8d = f.amount('8d', 'Wages already subject to social security tax', line8a);
	const line9 = f.amount('9', 'Line 7 less line 8d', Math.max(0, line7 - line8d));
	const line10 = f.amount('10', `Smaller of line 6 or 9 × ${pct(se.socialSecurityRate)}`, Math.min(line6, line9) * se.socialSecurityRate);
	const line11 = f.amount('11', `Line 6 × ${pct(se.medicareRate)}`, line6 * se.medicareRate);
	const line12 = f.amount('12', 'Self-employment tax', line10 + line11, 'result');
	f.amount('13', 'Deduction for one-half of self-employment tax', line12 * 0.5, 'result');
	return f;
}

export function computeReturn(input: ReturnInput, constants: TaxYearConstants): ReturnComputation {
	const warnings: string[] = [...input.notes];
	const status: FilingStatus = input.filingStatus ?? 'single';
	if (!input.filingStatus) warnings.push('No filing status answered; computed as single.');
	if (constants.year !== input.year) warnings.push(`Using ${constants.year} tax tables for ${input.year}.`);

	const forms: ReturnForm[] = [];
	const married = status === 'mfj' || status === 'mfs' || status === 'qss';

	// Schedule C, one per business, in the name of whoever owns it
	const id = input.identity;
	const ownerName = (owner: 'taxpayer' | 'spouse') =>
		owner === 'spouse' ? `${id.spouseFirstName} ${id.spouseLastName}`.trim() : `${id.firstName} ${id.lastName}`.trim();
	const ownerSsn = (owner: 'taxpayer' | 'spouse') => (owner === 'spouse' ? id.spouseSsn : id.ssn);
	const scheduleCs = input.businesses.map((b) => {
		const form = scheduleC(b, warnings);
		form.text('name', 'Name of proprietor', ownerName(b.owner));
		form.text('ssn', 'Social security number', ownerSsn(b.owner));
		return { business: b, form };
	});
	const netProfitOf = (owner: 'taxpayer' | 'spouse') => sum(scheduleCs.filter((s) => s.business.owner === owner).map((s) => s.form.get('31')));
	const totalNetProfit = sum(scheduleCs.map((s) => s.form.get('31')));
	if (scheduleCs.some((s) => s.business.unassigned)) {
		warnings.push('Some Schedule C accounts have no business assigned; their figures are on a separate Schedule C.');
	}

	// Schedule SE per owner. W-2 wages are assumed to be the taxpayer's.
	const scheduleSEs: { owner: 'taxpayer' | 'spouse'; form: FormBuilder }[] = [];
	for (const owner of ['taxpayer', 'spouse'] as const) {
		if (!scheduleCs.some((s) => s.business.owner === owner)) continue;
		const se = scheduleSE(owner, netProfitOf(owner), owner === 'taxpayer' ? input.socialSecurityWages : 0, constants, warnings);
		if (!se) continue;
		se.text('name', 'Name of person with self-employment income', ownerName(owner));
		se.text('ssn', 'Social security number of person with self-employment income', ownerSsn(owner));
		scheduleSEs.push({ owner, form: se });
	}
	if (scheduleSEs.length > 1) warnings.push('W-2 wages were counted against the taxpayer’s Schedule SE only.');
	const seTax = sum(scheduleSEs.map((s) => s.form.get('12')));
	const seDeduction = sum(scheduleSEs.map((s) => s.form.get('13')));
	const seEarnings = sum(scheduleSEs.map((s) => s.form.get('4c')));
	const seDeductionOf = (owner: 'taxpayer' | 'spouse') => scheduleSEs.find((s) => s.owner === owner)?.form.get('13') ?? 0;

	// Deductions attributable to each business: its owner's self-employment
	// tax deduction in proportion to its share of the owner's profit, plus its
	// own retirement contribution. They limit the health insurance deduction
	// and reduce qualified business income.
	const attributable = scheduleCs.map(({ business, form }) => {
		const profit = form.get('31');
		const ownerProfit = sum(scheduleCs.filter((s) => s.business.owner === business.owner).map((s) => Math.max(0, s.form.get('31'))));
		const se = ownerProfit > 0 ? round2((seDeductionOf(business.owner) * Math.max(0, profit)) / ownerProfit) : 0;
		return { profit, se, sep: business.sepContribution, limit: Math.max(0, round2(profit - se - business.sepContribution)) };
	});
	// The health insurance plan is established under one business; without an
	// answer, take the one that can absorb the most.
	const planBusiness = attributable.reduce((best, a, i) => (a.limit > attributable[best].limit ? i : best), 0);

	// Form 1040 income
	const f1040 = new FormBuilder('f1040', 'Form 1040', 'U.S. Individual Income Tax Return');
	f1040.text('firstName', 'Your first name and middle initial', id.firstName);
	f1040.text('lastName', 'Last name', id.lastName);
	f1040.text('ssn', 'Your social security number', id.ssn);
	if (married) {
		f1040.text('spouseFirstName', 'Spouse’s first name and middle initial', id.spouseFirstName);
		f1040.text('spouseLastName', 'Spouse’s last name', id.spouseLastName);
		f1040.text('spouseSsn', 'Spouse’s social security number', id.spouseSsn);
	}
	f1040.text('street', 'Home address', id.street);
	f1040.text('apt', 'Apt. no.', id.apt);
	f1040.text('city', 'City, town, or post office', id.city);
	f1040.text('state', 'State', id.state);
	f1040.text('zip', 'ZIP code', id.zip);
	f1040.text('occupation', 'Your occupation', id.occupation);
	if (married) f1040.text('spouseOccupation', 'Spouse’s occupation', id.spouseOccupation);
	f1040.check(`status:${status}`);
	if (!id.firstName || !id.ssn) warnings.push('Name and social security number are not answered; the PDF will have them blank.');

	// Dependents table
	input.dependentDetails.slice(0, 4).forEach((d, i) => {
		const n = i + 1;
		f1040.text(`dep.first.${n}`, `Dependent ${n} first name`, d.firstName);
		f1040.text(`dep.last.${n}`, `Dependent ${n} last name`, d.lastName);
		f1040.text(`dep.ssn.${n}`, `Dependent ${n} social security number`, d.ssn);
		f1040.text(`dep.rel.${n}`, `Dependent ${n} relationship`, d.relationship);
		const lived = (d.monthsLived ?? 0) > 6;
		f1040.check(`dep.lived.${n}`, lived);
		f1040.check(`dep.us.${n}`, lived);
		f1040.check(`dep.student.${n}`, d.status === 'student');
		f1040.check(`dep.disabled.${n}`, d.status === 'disabled');
		const child = d.birthYear !== null && underAge(d, input.year, 17) && d.ssn !== '';
		f1040.check(`dep.ctc.${n}`, child);
		f1040.check(`dep.odc.${n}`, d.birthYear !== null && !child);
	});
	if (input.dependents > 4) {
		f1040.check('dependents:more');
		warnings.push('More than four dependents; the Form 1040 table holds four, so list the rest on an attached statement.');
	}
	if (input.dependentDetails.length < input.dependents) {
		warnings.push(`${input.dependents - input.dependentDetails.length} of the ${input.dependents} dependent(s) have no name or social security number answered; the Form 1040 dependents table needs them.`);
	}
	const detailedChildren = input.dependentDetails.filter((d) => d.birthYear !== null && underAge(d, input.year, 17) && d.ssn !== '').length;
	if (input.dependentDetails.length >= input.dependents && input.dependentDetails.every((d) => d.birthYear !== null) && detailedChildren !== input.qualifyingChildren) {
		warnings.push(`The dependent details show ${detailedChildren} child(ren) under 17 with a social security number, but the child tax credit answer says ${input.qualifyingChildren}.`);
	}

	const line1a = f1040.amount('1a', 'Total amount from Form(s) W-2, box 1', input.wages, 'input');
	const line1z = f1040.amount('1z', 'Add lines 1a through 1h', line1a);
	const taxableInterest = sum(input.interest.taxable.map((p) => p.amount));
	f1040.amount('2a', 'Tax-exempt interest', input.interest.taxExempt, 'input');
	const line2b = f1040.amount('2b', 'Taxable interest', taxableInterest, 'input');
	const ordinaryDividends = input.dividends.ordinaryIncludesQualified
		? sum(input.dividends.ordinary.map((p) => p.amount))
		: sum([...input.dividends.ordinary.map((p) => p.amount), input.dividends.qualified]);
	const qualifiedDividends = Math.min(input.dividends.qualified, ordinaryDividends);
	f1040.amount('3a', 'Qualified dividends', qualifiedDividends, 'input');
	const line3b = f1040.amount(
		'3b',
		'Ordinary dividends',
		ordinaryDividends,
		'input',
		input.dividends.ordinaryIncludesQualified ? 'Box 1a of the 1099-DIV, which includes qualified dividends' : 'Ordinary plus qualified dividends recorded in the books'
	);
	f1040.amount('4a', 'IRA distributions', input.retirement.gross, 'input');
	const line4b = f1040.amount('4b', 'Taxable amount', input.retirement.taxable, 'input');
	if (input.retirement.gross > 0) {
		warnings.push('Retirement distributions were placed on line 4 (IRA distributions); move pension or annuity amounts to line 5 by hand.');
	}
	if (input.retirement.gross > input.retirement.taxable) {
		warnings.push(
			`${money(input.retirement.gross - input.retirement.taxable)} of the retirement distributions is treated as nontaxable; Form 8606 (Roth IRA or nondeductible IRA basis) supports that and is not produced.`
		);
	}

	// Schedule D
	let line7 = 0;
	let netLongTermGain = 0;
	let netCapital = 0;
	let scheduleD: FormBuilder | null = null;
	const { shortTerm, longTerm, distributions } = input.capitalGains;
	if (shortTerm !== 0 || longTerm !== 0 || distributions !== 0) {
		scheduleD = new FormBuilder('f1040sd', 'Schedule D', 'Capital Gains and Losses');
		scheduleD.text('name', 'Name(s) shown on return', `${id.firstName} ${id.lastName}`.trim());
		scheduleD.text('ssn', 'Your social security number', id.ssn);
		scheduleD.amount('1a', 'Short-term totals from Form 1099-B (gain or loss)', shortTerm, 'input');
		const d7 = scheduleD.amount('7', 'Net short-term capital gain or loss', shortTerm, 'total');
		scheduleD.amount('8a', 'Long-term totals from Form 1099-B (gain or loss)', longTerm, 'input');
		const d13 = scheduleD.amount('13', 'Capital gain distributions', distributions, 'input', 'Box 2a of the 1099-DIVs; always long-term');
		const d15 = scheduleD.amount('15', 'Net long-term capital gain or loss', longTerm + d13, 'total', 'Lines 8a through 14');
		const d16 = scheduleD.amount('16', 'Combine lines 7 and 15', d7 + d15, 'total');
		netCapital = d16;
		const limit = constants.capitalLossLimit[status];
		if (d16 < 0) {
			line7 = scheduleD.amount('21', `Loss limited to $${limit.toLocaleString('en-US')}`, Math.max(d16, -limit), 'result');
		} else {
			line7 = d16;
		}
		netLongTermGain = d15 > 0 && d16 > 0 ? Math.min(d15, d16) : 0;
		warnings.push('Schedule D shows net gains only; proceeds and cost basis columns need the 1099-B detail or Form 8949.');
	}
	f1040.amount('7', 'Capital gain or loss', line7, 'input');

	// Schedule 1
	const s1 = new FormBuilder('f1040s1', 'Schedule 1', 'Additional Income and Adjustments to Income');
	s1.text('name', 'Name(s) shown on Form 1040', `${id.firstName} ${id.lastName}`.trim());
	s1.text('ssn', 'Your social security number', id.ssn);
	const s1On = (line: string) => sum(input.schedule1.filter((e) => e.line === line).map((e) => e.amount));
	if (input.stateRefund > 0) {
		warnings.push(`A 1099-G reports a ${money(input.stateRefund)} state refund; it is taxable only if last year’s return itemized, so it was left off Schedule 1 line 1.`);
	}
	s1.amount('1', 'Taxable refunds of state and local income taxes', s1On('1'), 'input');
	s1.amount('3', 'Business income or loss (Schedule C)', totalNetProfit, 'input');
	s1.amount('5', 'Rental real estate, royalties, partnerships (Schedule E)', input.scheduleENet + s1On('5'), 'input');
	if (input.scheduleENet !== 0) warnings.push('Schedule E net is carried to Schedule 1 line 5, but Schedule E itself is not produced.');
	s1.amount('7', 'Unemployment compensation', input.unemployment + s1On('7'), 'input');
	const s1Other = ['2a', '4', '6', '8z'].map((l) => s1.amount(l, `Line ${l}`, s1On(l), 'input'));
	const s1Line9 = s1.amount('9', 'Total other income', s1On('8z') + s1On('9'));
	const s1Line10 = s1.amount('10', 'Additional income', s1.get('1') + s1.get('3') + s1.get('5') + s1.get('7') + s1Other[0] + s1Other[1] + s1Other[2] + s1Line9, 'total');
	const sep = sum(input.businesses.map((b) => b.sepContribution));
	s1.amount('15', 'Deductible part of self-employment tax', seDeduction, 'input');
	s1.amount('16', 'Self-employed SEP, SIMPLE, and qualified plans', sep + s1On('16'), 'input');
	const premiums = s1On('17');
	let sehi = premiums;
	let sehiExcess = 0;
	let sehiDetail: string | undefined;
	if (premiums > 0 && attributable.length > 0) {
		const plan = attributable[planBusiness];
		const planName = scheduleCs[planBusiness].business.name ?? 'the Schedule C business';
		sehi = Math.min(premiums, plan.limit);
		sehiExcess = round2(premiums - sehi);
		sehiDetail = `Limited to ${money(plan.limit)}: net profit of ${planName} (${money(plan.profit)}) less its self-employment tax deduction (${money(plan.se)})${plan.sep ? ` and retirement contribution (${money(plan.sep)})` : ''}`;
		if (sehiExcess > 0) {
			warnings.push(
				`Self-employed health insurance premiums of ${money(premiums)} exceed the ${money(plan.limit)} of net self-employment earnings from ${planName}; ${money(sehiExcess)} was moved to Schedule A medical expenses.`
			);
		}
		if (scheduleCs.length > 1) warnings.push(`The health insurance plan is assumed to be established under ${planName}, the business with the largest net earnings.`);
	} else if (premiums > 0) {
		warnings.push('Self-employed health insurance deduction is not checked against net self-employment earnings (no Schedule C).');
	}
	s1.amount('17', 'Self-employed health insurance deduction', sehi, 'input', sehiExcess > 0 ? sehiDetail : undefined);
	const s1AdjLines = ['11', '12', '13', '14', '18', '19a', '20', '21', '23'].map((l) => s1.amount(l, `Line ${l}`, s1On(l), 'input'));
	const s1Line26 = s1.amount('26', 'Adjustments to income', s1.get('15') + s1.get('16') + s1.get('17') + sum(s1AdjLines), 'total');
	if (sep > 0) warnings.push(`SEP contribution of ${money(sep)} is taken as answered; the deductible maximum depends on net earnings and is not checked.`);

	const line8 = f1040.amount('8', 'Additional income from Schedule 1, line 10', s1Line10, 'input');
	const line9 = f1040.amount('9', 'Total income', line1z + line2b + line3b + line4b + line7 + line8, 'total');
	const line10 = f1040.amount('10', 'Adjustments to income from Schedule 1, line 26', s1Line26, 'input');
	const agi = f1040.amount('11', 'Adjusted gross income', line9 - line10, 'total');
	f1040.amount('11b', 'Amount from line 11a (adjusted gross income)', agi);

	// Schedule A versus the standard deduction
	const it = { ...input.itemized, medical: round2(input.itemized.medical + sehiExcess) };
	for (const key of Object.keys(it) as (keyof typeof it)[]) {
		if (it[key] < 0) {
			warnings.push(`Schedule A ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} is ${money(it[key])} because refunds exceed payments; it was set to zero.`);
			it[key] = 0;
		}
	}
	const additional = input.additionalDeductionBoxes * (married ? constants.additionalStandardDeduction.married : constants.additionalStandardDeduction.single);
	const standard = round2(constants.standardDeduction[status] + additional);
	let scheduleA: FormBuilder | null = null;
	let itemizedTotal = 0;
	if (it.medical || it.stateLocalIncomeTaxes || it.realEstateTaxes || it.personalPropertyTaxes || it.mortgageInterest || it.charityCash || it.charityNonCash) {
		const a = new FormBuilder('f1040sa', 'Schedule A', 'Itemized Deductions');
		a.text('name', 'Name(s) shown on Form 1040', `${id.firstName} ${id.lastName}`.trim());
		a.text('ssn', 'Your social security number', id.ssn);
		const a1 = a.amount('1', 'Medical and dental expenses', it.medical, 'input', sehiExcess > 0 ? `Includes ${money(sehiExcess)} of health insurance premiums over the Schedule 1 line 17 limit` : undefined);
		const a2 = a.amount('2', 'Adjusted gross income', agi, 'input');
		const a3 = a.amount('3', `Line 2 × ${pct(constants.medicalFloorRate)}`, Math.max(0, a2) * constants.medicalFloorRate);
		const a4 = a.amount('4', 'Deductible medical expenses', Math.max(0, a1 - a3));
		const a5a = a.amount('5a', 'State and local income taxes', it.stateLocalIncomeTaxes, 'input');
		const a5b = a.amount('5b', 'State and local real estate taxes', it.realEstateTaxes, 'input');
		const a5c = a.amount('5c', 'State and local personal property taxes', it.personalPropertyTaxes, 'input');
		const a5d = a.amount('5d', 'Add lines 5a through 5c', a5a + a5b + a5c);
		let cap = constants.salt.cap[status];
		let capDetail = `Capped at ${money(cap)}`;
		const pd = constants.salt.phaseDown;
		if (pd && agi > pd.threshold[status]) {
			cap = Math.max(pd.floor[status], round2(cap - pd.rate * (agi - pd.threshold[status])));
			capDetail = `Cap reduced to ${money(cap)} because AGI exceeds ${money(pd.threshold[status])}`;
		}
		const a5e = a.amount('5e', 'Deductible state and local taxes', Math.min(a5d, cap), 'computed', capDetail);
		const a7 = a.amount('7', 'Total taxes paid', a5e, 'total');
		const a8a = a.amount('8a', 'Home mortgage interest and points from Form 1098', it.mortgageInterest, 'input');
		const a8e = a.amount('8e', 'Add lines 8a through 8c', a8a);
		const a10 = a.amount('10', 'Total interest paid', a8e, 'total');
		const a11 = a.amount('11', 'Gifts by cash or check', it.charityCash, 'input');
		const a12 = a.amount('12', 'Gifts other than by cash or check', it.charityNonCash, 'input');
		const a14 = a.amount('14', 'Total gifts to charity', a11 + a12, 'total');
		itemizedTotal = a.amount('17', 'Total itemized deductions', a4 + a7 + a10 + a14, 'result');
		if (it.mortgageInterest > 0) warnings.push('Mortgage interest is deducted in full; the $750,000 loan limit is not checked.');
		if (it.charityCash + it.charityNonCash > 0) warnings.push('Charitable gifts are deducted in full; the AGI percentage limits are not checked.');
		scheduleA = a;
	}
	const itemize = itemizedTotal > standard;
	const line12 = f1040.amount(
		'12e',
		itemize ? 'Itemized deductions from Schedule A' : 'Standard deduction',
		itemize ? itemizedTotal : standard,
		'input',
		itemize
			? `Itemized ${money(itemizedTotal)} exceeds the ${money(standard)} standard deduction`
			: `${money(constants.standardDeduction[status])} for ${FILING_STATUS_LABELS[status].toLowerCase()}${additional ? ` plus ${money(additional)} for ${input.additionalDeductionBoxes} box(es) on line 12d` : ''}${itemizedTotal ? `; itemizing would give ${money(itemizedTotal)}` : ''}`
	);
	if (!itemize) scheduleA = null;
	for (let i = 0; i < input.additionalDeductionBoxes && i < 4; i++) f1040.check(`age-or-blind:${i}`);

	// Form 8995: the simplified QBI deduction
	let f8995: FormBuilder | null = null;
	let qbiDeduction = 0;
	const taxableBeforeQbi = Math.max(0, agi - line12);
	if (scheduleCs.length > 0) {
		const q = constants.qualifiedBusinessIncome;
		const f = new FormBuilder('f8995', 'Form 8995', 'Qualified Business Income Deduction Simplified Computation');
		f.text('name', 'Name(s) shown on return', `${id.firstName} ${id.lastName}`.trim());
		f.text('ssn', 'Your taxpayer identification number', id.ssn);
		// Each business's QBI is its net profit less the deductions attributable to it
		const rows = ['i', 'ii', 'iii', 'iv', 'v'];
		let qbiTotal = 0;
		scheduleCs.forEach(({ business }, i) => {
			const a = attributable[i];
			if (a.profit < 0) warnings.push(`${business.name ?? 'A business'} shows a loss; it reduces qualified business income.`);
			const health = i === planBusiness ? sehi : 0;
			const qbi = round2(a.profit - a.se - a.sep - health);
			qbiTotal = round2(qbiTotal + qbi);
			if (i >= rows.length) return;
			const label = business.unassigned ? 'Unassigned Schedule C accounts' : business.name || business.description || 'Schedule C';
			f.text(`1${rows[i]}.name`, `Trade or business ${i + 1}`, label);
			f.amount(
				`1${rows[i]}.qbi`,
				`Qualified business income ${i + 1}`,
				qbi,
				'input',
				`Net profit ${money(a.profit)} less the self-employment tax deduction (${money(a.se)})${a.sep ? `, retirement contribution (${money(a.sep)})` : ''}${health ? ` and health insurance deduction (${money(health)})` : ''} attributable to it`
			);
		});
		if (scheduleCs.length > rows.length) warnings.push('Form 8995 lists five businesses; the rest are in the total only.');
		const f2 = f.amount('2', 'Total qualified business income', qbiTotal, 'total');
		const f4 = f.amount('4', 'Total qualified business income (not below zero)', Math.max(0, f2));
		const f5 = f.amount('5', `Qualified business income component (${pct(q.rate)})`, f4 * q.rate);
		const f10 = f.amount('10', 'QBI deduction before the income limitation', f5);
		const f11 = f.amount('11', 'Taxable income before the QBI deduction', taxableBeforeQbi, 'input');
		const f12 = f.amount('12', 'Net capital gain plus qualified dividends', Math.max(0, netLongTermGain) + qualifiedDividends, 'input');
		const f13 = f.amount('13', 'Line 11 less line 12', Math.max(0, f11 - f12));
		const f14 = f.amount('14', `Income limitation (${pct(q.rate)})`, f13 * q.rate);
		let deduction = Math.min(f10, f14);
		const threshold = q.threshold[status];
		if (f11 > threshold) {
			const range = q.phaseInRange[status];
			const over = f11 - threshold;
			const reduction = Math.min(1, over / range);
			deduction = round2(deduction * (1 - reduction));
			warnings.push(
				over >= range
					? `Taxable income is above ${money(threshold + range)}, where the simplified QBI deduction on Form 8995 no longer applies; it was set to zero. Form 8995-A may allow some deduction.`
					: `Taxable income is above the ${money(threshold)} threshold for Form 8995; the QBI deduction was reduced by ${pct(reduction)} as an estimate. Form 8995-A applies.`
			);
		}
		qbiDeduction = f.amount('15', 'Qualified business income deduction', deduction, 'result');
		const f16 = f.amount('16', 'Total qualified business (loss) carryforward', Math.min(0, f2), 'result');
		if (f16 < 0) warnings.push(`Qualified business loss of ${money(-f16)} carries forward to next year's Form 8995 line 3 (not tracked).`);
		f8995 = f;
	}

	// Tax and credits
	f1040.amount('13a', 'Qualified business income deduction from Form 8995', qbiDeduction, 'input');
	const line14 = f1040.amount('14', 'Add lines 12e, 13a, and 13b', line12 + qbiDeduction);
	const taxable = f1040.amount('15', 'Taxable income', Math.max(0, agi - line14), 'total');
	if (netCapital < -constants.capitalLossLimit[status]) {
		// Capital Loss Carryover Worksheet: only as much of the loss as offsets income is used up
		const w1 = round2(agi - line14);
		const w2 = -line7;
		const used = Math.max(0, Math.min(w2, round2(w1 + w2)));
		const carry = round2(-netCapital - used);
		warnings.push(
			`Capital loss of ${money(-netCapital)}: ${money(used)} is used this year${used < w2 ? ` (taxable income is ${money(w1)} before it, so the rest of the deduction gives no benefit)` : ''} and ${money(carry)} carries forward to ${input.year + 1} (not tracked).`
		);
	}
	const usePreferential = qualifiedDividends > 0 || netLongTermGain > 0;
	let line16: number;
	if (usePreferential) {
		const w = qualifiedDividendsAndCapitalGainTax(taxable, qualifiedDividends, netLongTermGain, constants, status);
		line16 = f1040.amount(
			'16',
			'Tax',
			w.tax,
			'computed',
			`Qualified Dividends and Capital Gain Tax Worksheet: ${money(w.preferential)} at preferential rates (${money(w.atZero)} at 0%, ${money(w.atFifteen)} at 15%, ${money(w.atTwenty)} at 20%), the rest at bracket rates`
		);
	} else {
		line16 = f1040.amount('16', 'Tax', bracketTax(taxable, constants, status), 'computed', `${constants.year} brackets for ${FILING_STATUS_LABELS[status].toLowerCase()}`);
	}
	f1040.amount('17', 'Amount from Schedule 2, line 3', 0, 'input');
	const line18 = f1040.amount('18', 'Add lines 16 and 17', line16);

	// Schedule 8812 Part I: the child tax credit and credit for other dependents
	const ctc = constants.childTaxCredit;
	const otherDependents = Math.max(0, input.dependents - input.qualifyingChildren);
	const s8812 = input.dependents > 0 ? new FormBuilder('f1040s8', 'Schedule 8812', 'Credits for Qualifying Children and Other Dependents') : null;
	let line19 = 0;
	let ctcUnused = 0;
	if (s8812) {
		s8812.text('name', 'Name(s) shown on return', `${id.firstName} ${id.lastName}`.trim());
		s8812.text('ssn', 'Your social security number', id.ssn);
		const c1 = s8812.amount('1', 'Amount from Form 1040 line 11a', agi, 'input');
		const c2d = s8812.amount('2d', 'Add lines 2a through 2c', 0);
		const c3 = s8812.amount('3', 'Add lines 1 and 2d', c1 + c2d);
		s8812.text('4', 'Qualifying children under age 17 with the required social security number', String(input.qualifyingChildren));
		const c5 = s8812.amount('5', `Line 4 × ${money(ctc.perChild)}`, input.qualifyingChildren * ctc.perChild);
		s8812.text('6', 'Other dependents', String(otherDependents));
		const c7 = s8812.amount('7', `Line 6 × ${money(ctc.perOtherDependent)}`, otherDependents * ctc.perOtherDependent);
		const c8 = s8812.amount('8', 'Add lines 5 and 7', c5 + c7);
		const c9 = s8812.amount('9', `Phase-out threshold for ${FILING_STATUS_LABELS[status].toLowerCase()}`, ctc.phaseOutStart[status], 'input');
		const c10 = s8812.amount('10', 'Line 3 less line 9, rounded up to the next $1,000', c3 > c9 ? Math.ceil((c3 - c9) / 1000) * 1000 : 0);
		const c11 = s8812.amount('11', `Line 10 × ${pct(ctc.reductionPerThousand / 1000)}`, (c10 / 1000) * ctc.reductionPerThousand);
		const c12 = s8812.amount('12', 'Line 8 less line 11', Math.max(0, c8 - c11));
		s8812.check(c12 > 0 ? '12:yes' : '12:no');
		const c13 = s8812.amount('13', 'Credit Limit Worksheet A (Form 1040 line 18)', line18, 'input');
		line19 = s8812.amount('14', 'Child tax credit and credit for other dependents', Math.min(c12, c13), 'result');
		ctcUnused = round2(c12 - line19);
	}
	f1040.amount(
		'19',
		'Child tax credit or credit for other dependents',
		line19,
		'computed',
		s8812
			? `Schedule 8812: ${input.qualifyingChildren} child(ren) × ${money(ctc.perChild)}${otherDependents ? ` plus ${otherDependents} other dependent(s) × ${money(ctc.perOtherDependent)}` : ''}, limited to the tax on line 18`
			: undefined
	);
	f1040.amount('20', 'Amount from Schedule 3, line 8', 0, 'input');
	const line21 = f1040.amount('21', 'Add lines 19 and 20', line19);
	const line22 = f1040.amount('22', 'Line 18 less line 21', Math.max(0, line18 - line21));

	// Schedule 2: other taxes
	const s2 = new FormBuilder('f1040s2', 'Schedule 2', 'Additional Taxes');
	s2.text('name', 'Name(s) shown on Form 1040', `${id.firstName} ${id.lastName}`.trim());
	s2.text('ssn', 'Your social security number', id.ssn);
	s2.amount('3', 'Total additions to tax', 0, 'total');
	s2.amount('4', 'Self-employment tax (Schedule SE)', seTax, 'input');
	const am = constants.additionalMedicare;
	const medicareBase = input.medicareWages + seEarnings;
	const additionalMedicare = s2.amount(
		'11',
		'Additional Medicare Tax (Form 8959)',
		Math.max(0, medicareBase - am.threshold[status]) * am.rate,
		'computed',
		medicareBase > am.threshold[status] ? `${pct(am.rate)} of ${money(medicareBase)} in Medicare wages and self-employment earnings over ${money(am.threshold[status])}` : `Medicare wages and self-employment earnings of ${money(medicareBase)} are under the ${money(am.threshold[status])} threshold`
	);
	const nii = constants.netInvestmentIncome;
	const investmentIncome = Math.max(0, taxableInterest + ordinaryDividends + line7);
	const niit = s2.amount(
		'12',
		'Net investment income tax (Form 8960)',
		Math.min(investmentIncome, Math.max(0, agi - nii.threshold[status])) * nii.rate,
		'computed',
		agi > nii.threshold[status] ? `${pct(nii.rate)} of the smaller of ${money(investmentIncome)} investment income or AGI over ${money(nii.threshold[status])}` : `AGI is under the ${money(nii.threshold[status])} threshold`
	);
	const s2Line21 = s2.amount('21', 'Total other taxes', seTax + additionalMedicare + niit, 'total');
	if (additionalMedicare > 0) warnings.push('Additional Medicare Tax is computed on the total; Form 8959 also credits any extra withheld by an employer.');
	if (niit > 0) warnings.push('Net investment income tax uses interest, dividends, and capital gains; rental income and investment expenses are not included.');

	const line23 = f1040.amount('23', 'Other taxes from Schedule 2, line 21', s2Line21, 'input');
	const totalTax = f1040.amount('24', 'Total tax', line22 + line23, 'total');

	// Payments
	const line25a = f1040.amount('25a', 'Federal income tax withheld from Form(s) W-2', input.withholding.w2, 'input');
	const line25b = f1040.amount('25b', 'Federal income tax withheld from Form(s) 1099', input.withholding.forms1099, 'input');
	const line25c = f1040.amount('25c', 'Federal income tax withheld from other forms', 0, 'input');
	const line25d = f1040.amount('25d', 'Total withholding', line25a + line25b + line25c);
	const line26 = f1040.amount('26', `${input.year} estimated tax payments`, input.estimatedPayments, 'input');

	// Earned income for the refundable credits: wages plus Schedule C profit
	// after the deductible half of self-employment tax
	const earnedIncome = round2(line1z + totalNetProfit - seDeduction);

	// The earned income credit, with Schedule EIC for the qualifying children
	const eicChildren = input.dependentDetails.filter(
		(d) => d.ssn !== '' && (d.monthsLived ?? 0) > 6 && (underAge(d, input.year, 19) || (d.status === 'student' && underAge(d, input.year, 24)) || d.status === 'disabled')
	);
	let eicChildCount = eicChildren.length;
	if (eicChildCount === 0 && input.qualifyingChildren > 0) {
		eicChildCount = input.qualifyingChildren;
		warnings.push(
			`The earned income credit assumes the ${input.qualifyingChildren} child(ren) counted for the child tax credit qualify; answer the dependent questions (name, social security number, year of birth, months lived with you) so Schedule EIC can be filled.`
		);
	}
	const eicInvestmentIncome = round2(taxableInterest + input.interest.taxExempt + ordinaryDividends + Math.max(0, line7) + Math.max(0, input.scheduleENet));
	const eic = earnedIncomeCredit(earnedIncome, agi, eicChildCount, eicInvestmentIncome, constants, status);
	const line27a = f1040.amount('27a', 'Earned income credit (EIC)', eic.credit, 'input', eic.detail);
	if (eic.credit > 0) {
		warnings.push(
			'Earned income credit: not checked are the age rule (25 to 64 without a qualifying child), the residency and social security number rules, and whether someone else could claim the same child.'
		);
	}
	let scheduleEIC: FormBuilder | null = null;
	if (eic.credit > 0 && eicChildren.length > 0) {
		scheduleEIC = new FormBuilder('f1040sei', 'Schedule EIC', 'Earned Income Credit: Qualifying Child Information');
		scheduleEIC.text('name', 'Name(s) shown on return', `${id.firstName} ${id.lastName}`.trim());
		scheduleEIC.text('ssn', 'Your social security number', id.ssn);
		eicChildren.slice(0, 3).forEach((d, i) => {
			const n = i + 1;
			scheduleEIC!.text(`1.name.${n}`, `Child ${n} name`, `${d.firstName} ${d.lastName}`.trim());
			scheduleEIC!.text(`2.ssn.${n}`, `Child ${n} social security number`, d.ssn);
			scheduleEIC!.text(`3.year.${n}`, `Child ${n} year of birth`, String(d.birthYear));
			if (!underAge(d, input.year, 19)) {
				const student = d.status === 'student' && underAge(d, input.year, 24);
				scheduleEIC!.check(`4a.${student ? 'yes' : 'no'}.${n}`);
				scheduleEIC!.check(`4b.yes.${n}`, !student && d.status === 'disabled');
			}
			scheduleEIC!.text(`5.rel.${n}`, `Child ${n} relationship`, d.relationship);
			scheduleEIC!.text(`6.months.${n}`, `Child ${n} months lived with you`, String(Math.min(12, d.monthsLived ?? 0)));
		});
	}

	// Schedule 8812 Part II: the additional child tax credit, the refundable part of what line 18 could not absorb
	let line28 = 0;
	if (s8812 && ctcUnused > 0 && input.qualifyingChildren > 0) {
		const actc = constants.additionalChildTaxCredit;
		const c16a = s8812.amount('16a', 'Line 12 less line 14', ctcUnused);
		s8812.text('16b.count', 'Qualifying children for line 16b', String(input.qualifyingChildren));
		const c16b = s8812.amount('16b', `${input.qualifyingChildren} qualifying child(ren) × ${money(actc.perChild)}`, input.qualifyingChildren * actc.perChild);
		const c17 = s8812.amount('17', 'Smaller of line 16a or line 16b', Math.min(c16a, c16b));
		const c18a = s8812.amount('18a', 'Earned income', earnedIncome, 'input', 'Wages plus Schedule C net profit, less the deductible part of self-employment tax');
		const c19 = s8812.amount('19', `Line 18a less ${money(actc.earnedIncomeFloor)}`, Math.max(0, c18a - actc.earnedIncomeFloor));
		s8812.check(c19 > 0 ? '19:yes' : '19:no');
		const c20 = s8812.amount('20', `Line 19 × ${pct(actc.rate)}`, c19 * actc.rate);
		let c26 = c20;
		const threeOrMore = c16b >= 3 * actc.perChild;
		s8812.check(threeOrMore ? '20:yes' : '20:no');
		if (threeOrMore && c20 < c17) {
			// Part II-B: payroll and self-employment taxes paid, less the EIC, can support a larger credit
			const c21 = s8812.amount('21', 'Social security and Medicare tax withheld (W-2 boxes 4 and 6)', input.socialSecurityWages * 0.062 + input.medicareWages * 0.0145, 'input', 'Estimated from W-2 wages');
			const c22 = s8812.amount('22', 'Schedule 1 line 15 and Schedule 2 lines 5, 6 and 13', seDeduction, 'input');
			const c23 = s8812.amount('23', 'Add lines 21 and 22', c21 + c22);
			const c24 = s8812.amount('24', 'Form 1040 line 27a and Schedule 3 line 11', line27a, 'input');
			const c25 = s8812.amount('25', 'Line 23 less line 24', Math.max(0, c23 - c24));
			c26 = s8812.amount('26', 'Larger of line 20 or line 25', Math.max(c20, c25));
			if (input.socialSecurityWages > 0) warnings.push('Schedule 8812 line 21 estimates social security and Medicare tax withheld from W-2 wages; check it against boxes 4 and 6.');
		}
		line28 = s8812.amount('27', 'Additional child tax credit', Math.min(c17, c26), 'result');
	}
	f1040.amount('28', 'Additional child tax credit from Schedule 8812', line28, 'input');

	let s3: FormBuilder | null = null;
	let line31 = 0;
	if (input.extensionPayment > 0) {
		s3 = new FormBuilder('f1040s3', 'Schedule 3', 'Additional Credits and Payments');
		s3.text('name', 'Name(s) shown on Form 1040', `${id.firstName} ${id.lastName}`.trim());
		s3.text('ssn', 'Your social security number', id.ssn);
		s3.amount('8', 'Total nonrefundable credits', 0, 'total');
		const s3Line10 = s3.amount('10', 'Amount paid with request for extension to file', input.extensionPayment, 'input');
		line31 = s3.amount('15', 'Total other payments and refundable credits', s3Line10, 'total');
	}
	f1040.amount('31', 'Amount from Schedule 3, line 15', line31, 'input');
	const line32 = f1040.amount('32', 'Total other payments and refundable credits', line27a + line28 + line31);
	const refundableCredits = round2(line27a + line28);
	const totalPayments = f1040.amount('33', 'Total payments', line25d + line26 + line32, 'total');
	const refund = f1040.amount('34', 'Amount overpaid', Math.max(0, totalPayments - totalTax), 'result');
	f1040.amount('35a', 'Amount of line 34 you want refunded to you', refund, 'result');
	const owed = f1040.amount('37', 'Amount you owe', Math.max(0, totalTax - totalPayments), 'result');
	if (owed > 0 && owed >= 1000) warnings.push('Amount owed is $1,000 or more; an underpayment penalty (Form 2210) may apply and is not computed.');
	warnings.push('Not computed: alternative minimum tax, credits other than the child tax credit and earned income credit, deductions on Schedule 1-A, prior-year carryovers, and depreciation.');

	// Schedule B lists payers when there is any interest or dividend income
	let scheduleB: FormBuilder | null = null;
	if (input.interest.taxable.length > 0 || input.dividends.ordinary.length > 0) {
		const b = new FormBuilder('f1040sb', 'Schedule B', 'Interest and Ordinary Dividends');
		b.text('name', 'Name(s) shown on return', `${id.firstName} ${id.lastName}`.trim());
		b.text('ssn', 'Your social security number', id.ssn);
		input.interest.taxable.slice(0, 14).forEach((p, i) => {
			b.text(`1.payer.${i + 1}`, `Interest payer ${i + 1}`, p.name);
			b.amount(`1.amount.${i + 1}`, `Interest from ${p.name}`, p.amount, 'input');
		});
		if (input.interest.taxable.length > 14) warnings.push('Schedule B has room for 14 interest payers; the rest were left off the PDF (the total is right).');
		const b2 = b.amount('2', 'Add the amounts on line 1', taxableInterest, 'total');
		b.amount('4', 'Taxable interest', b2, 'result');
		const dividendPayers = input.dividends.ordinaryIncludesQualified || input.dividends.qualified === 0
			? input.dividends.ordinary
			: [...input.dividends.ordinary, { name: 'Qualified dividends recorded in the books', amount: input.dividends.qualified }];
		dividendPayers.slice(0, 15).forEach((p, i) => {
			b.text(`5.payer.${i + 1}`, `Dividend payer ${i + 1}`, p.name);
			b.amount(`5.amount.${i + 1}`, `Dividends from ${p.name}`, p.amount, 'input');
		});
		if (dividendPayers.length > 15) warnings.push('Schedule B has room for 15 dividend payers; the rest were left off the PDF (the total is right).');
		b.amount('6', 'Ordinary dividends', ordinaryDividends, 'result');
		scheduleB = b;
	}

	forms.push(f1040.form, s1.form, s2.form);
	if (s3) forms.push(s3.form);
	if (scheduleA) forms.push(scheduleA.form);
	if (scheduleB) forms.push(scheduleB.form);
	for (const { form } of scheduleCs) forms.push(form.form);
	if (scheduleD) forms.push(scheduleD.form);
	for (const se of scheduleSEs) forms.push(se.form.form);
	if (scheduleEIC) forms.push(scheduleEIC.form);
	if (s8812) forms.push(s8812.form);
	if (f8995) forms.push(f8995.form);

	return {
		year: input.year,
		filingStatus: status,
		filingStatusLabel: FILING_STATUS_LABELS[status],
		forms,
		summary: {
			totalIncome: line9,
			adjustedGrossIncome: agi,
			deduction: line12,
			deductionKind: itemize ? 'itemized' : 'standard',
			qbiDeduction,
			taxableIncome: taxable,
			incomeTax: line16,
			selfEmploymentTax: seTax,
			totalTax,
			refundableCredits,
			totalPayments,
			refund,
			amountOwed: owed,
			effectiveRate: agi > 0 ? round2((totalTax / agi) * 100) : 0
		},
		warnings: Array.from(new Set(warnings))
	};
}
