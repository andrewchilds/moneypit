import { getTaxReportData, type ScheduleSection, type TaxCategoryTotal } from './reports';
import { getTaxYearStatus, type TaxYearStatus } from './taxYear';
import { normalizeFormType } from '$lib/taxForms';
import { computeReturn, type BusinessInput, type DependentInput, type PayerFigure, type ReturnComputation, type ReturnInput, type ScheduleLineFigure } from '../taxReturn/compute';
import { FILING_STATUSES, getTaxYearConstants, supportedTaxYears, type FilingStatus } from '../taxReturn/constants';
import type { FactValue } from '../taxModules';

export type TaxReturnResult =
	| { available: true; computation: ReturnComputation; input: ReturnInput }
	| { available: false; reason: string; supportedYears: number[] };

/** "Schedule C Line 24b" -> "24b" */
function lineOf(scheduleRef: string | null): string | null {
	const m = scheduleRef?.match(/Line\s+(\S+)$/i);
	return m ? m[1] : null;
}

function asNumber(value: FactValue | null | undefined): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

function asText(value: FactValue | null | undefined): string {
	return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** Answers for one questionnaire scope: the book (null) or a business */
function answersFor(status: TaxYearStatus, businessId: string | null): Map<string, FactValue> {
	const map = new Map<string, FactValue>();
	for (const m of status.modules) {
		if (m.businessId !== businessId) continue;
		for (const q of m.questions) if (q.answered && q.answer !== null) map.set(q.key, q.answer);
	}
	return map;
}

/**
 * Who paid a category's figure, for Schedule B: one entry per document line
 * when documents exist (plus whatever book figure they did not replace),
 * else one per account.
 */
function payersOf(category: TaxCategoryTotal | undefined): PayerFigure[] {
	if (!category) return [];
	const byName = new Map<string, number>();
	const add = (name: string, amount: number) => byName.set(name, Math.round(((byName.get(name) ?? 0) + amount) * 100) / 100);
	if (category.documentLines.length > 0) {
		// Several boxes from one issuer (a 1099-INT's box 1 and box 3) are one payer
		for (const line of category.documentLines) add(line.issuer, line.amount);
		const remaining = Math.round((category.total - category.bookReplaced) * 100) / 100;
		if (remaining !== 0) add('Other amounts recorded in the books', remaining);
	} else {
		for (const account of category.accounts) add(account.path, account.total);
	}
	// Worksheet figures never land on Schedule B categories, so the payers sum to the reported total
	return Array.from(byName, ([name, amount]) => ({ name, amount })).filter((p) => p.amount !== 0);
}

function categoryOn(section: ScheduleSection | undefined, line: string): TaxCategoryTotal | undefined {
	if (!section) return undefined;
	return [...section.incomeCategories, ...section.expenseCategories].find((c) => lineOf(c.scheduleRef) === line);
}

const reported = (category: TaxCategoryTotal | undefined) => category?.reportedTotal ?? 0;

/**
 * Assemble the return's input from the tax report, the questionnaire, and
 * the documents on hand, then compute it. Figures follow the report exactly:
 * a category's reported total is what lands on its line.
 */
export async function getTaxReturn(bookId: string, year: number): Promise<TaxReturnResult> {
	const constants = getTaxYearConstants(year);
	if (!constants) {
		return { available: false, reason: `No tax tables for ${year}.`, supportedYears: supportedTaxYears() };
	}

	const [report, status] = await Promise.all([getTaxReportData(bookId, year), getTaxYearStatus(bookId, year)]);
	const book = answersFor(status, null);
	const notes: string[] = [];

	const filingStatusRaw = asText(book.get('filing_status'));
	const filingStatus = (FILING_STATUSES as string[]).includes(filingStatusRaw) ? (filingStatusRaw as FilingStatus) : null;

	if (status.openQuestions > 0) notes.push(`${status.openQuestions} tax prep question(s) are unanswered.`);
	if (status.missingDocuments > 0) notes.push(`${status.missingDocuments} expected document(s) have not been entered.`);
	if (report.uncategorizedExpenses.length + report.uncategorizedIncome.length > 0) {
		notes.push(`${report.uncategorizedExpenses.length + report.uncategorizedIncome.length} account(s) with activity have no tax category and are not on the return.`);
	}
	// Documents: wages, withholding, and forms whose boxes have no category
	const docs = status.documents.filter((d) => d.status === 'RECEIVED');
	let wages = 0;
	let socialSecurityWages = 0;
	let medicareWages = 0;
	const withholding = { w2: 0, forms1099: 0 };
	const retirement = { gross: 0, taxable: 0 };
	let unemployment = 0;
	let stateRefund = 0;
	// Boxes the return reads directly (wages, withholding) need no category
	const consumed = new Set<string>();
	for (const doc of docs) {
		const form = normalizeFormType(doc.formType);
		const box = (b: string) => {
			const line = doc.lines.find((l) => l.box.toUpperCase() === b.toUpperCase());
			if (line) consumed.add(line.id);
			return line ? { amount: Number(line.amount), mapped: line.taxCategoryId !== null } : null;
		};
		if (form === 'W-2') {
			const b1 = box('1')?.amount ?? 0;
			wages += b1;
			withholding.w2 += box('2')?.amount ?? 0;
			socialSecurityWages += box('3')?.amount ?? b1;
			medicareWages += box('5')?.amount ?? b1;
		} else if (form.startsWith('1099')) {
			withholding.forms1099 += box('4')?.amount ?? 0;
			if (form === '1099-R') {
				const gross = box('1');
				const taxable = box('2a');
				if (gross && !gross.mapped) retirement.gross += gross.amount;
				if (taxable && !taxable.mapped) retirement.taxable += taxable.amount;
				else if (gross && !gross.mapped && !taxable) {
					retirement.taxable += gross.amount;
					notes.push(`1099-R from ${doc.issuer} has no box 2a; the gross distribution was treated as fully taxable.`);
				}
			} else if (form === '1099-G') {
				const b1 = box('1');
				const b2 = box('2');
				if (b1 && !b1.mapped) unemployment += b1.amount;
				if (b2 && !b2.mapped) stateRefund += b2.amount;
			}
		}
	}
	const unmapped = docs.flatMap((d) => d.lines).filter((l) => l.taxCategoryId === null && Number(l.amount) !== 0 && !consumed.has(l.id)).length;
	if (unmapped > 0) notes.push(`${unmapped} document line(s) have no tax category and are not on the return.`);
	const w2Expected = book.get('w2_wages') === true;
	if (w2Expected && wages === 0) notes.push('W-2 wages were answered yes but no W-2 with a box 1 amount is entered.');

	// Sections by schedule
	const sectionsOf = (schedule: string) => report.sections.filter((s) => s.schedule === schedule);
	const scheduleA = sectionsOf('Schedule A')[0];
	const scheduleB = sectionsOf('Schedule B')[0];
	const scheduleD = sectionsOf('Schedule D')[0];
	const scheduleE = sectionsOf('Schedule E')[0];
	const schedule1 = sectionsOf('Schedule 1')[0];
	const form1040 = sectionsOf('Form 1040')[0];
	// A 1099-R box 2a mapped to a category reaches line 4b through the report
	retirement.taxable += reported(categoryOn(form1040, '4b'));

	const taxExempt = report.nonDeductible.income.find((c) => c.taxCategoryName === 'Tax Exempt');
	const ordinaryDividends = categoryOn(scheduleB, '6');
	const qualifiedDividends = categoryOn(scheduleB, '5');

	const businesses: BusinessInput[] = sectionsOf('Schedule C').map((section) => {
		const answers = answersFor(status, section.businessId);
		const figures = (categories: TaxCategoryTotal[]): ScheduleLineFigure[] =>
			categories
				.map((c) => ({ line: lineOf(c.scheduleRef) ?? '', category: c.taxCategoryName, amount: c.reportedTotal }))
				.filter((f) => f.line !== '' && f.amount !== 0);
		const method = asText(answers.get('accounting_method'));
		return {
			id: section.businessId,
			name: section.businessName,
			unassigned: section.unassigned,
			owner: asText(answers.get('business_owner')) === 'spouse' ? 'spouse' : 'taxpayer',
			description: asText(answers.get('business_description')),
			code: asText(answers.get('business_code')),
			accountingMethod: method === 'cash' || method === 'accrual' ? method : null,
			income: figures(section.incomeCategories),
			expenses: figures(section.expenseCategories),
			sepContribution: asNumber(answers.get('sep_contribution'))
		};
	});

	const schedule1Lines: ScheduleLineFigure[] = schedule1
		? [...schedule1.incomeCategories, ...schedule1.expenseCategories]
				.map((c) => ({ line: lineOf(c.scheduleRef) ?? '', category: c.taxCategoryName, amount: c.reportedTotal }))
				.filter((f) => f.line !== '' && f.amount !== 0)
		: [];

	const dependents = asNumber(book.get('dependents'));
	if (dependents > 0 && book.get('qualifying_children') === undefined) {
		notes.push(`${dependents} dependent(s) are claimed but "children under 17 who qualify for the child tax credit" is unanswered; the return assumes none.`);
	}
	const dependentDetails: DependentInput[] = [];
	for (let n = 1; n <= 4; n++) {
		const key = (field: string) => book.get(`dependent_${n}_${field}`);
		const firstName = asText(key('first_name'));
		const ssn = asText(key('ssn'));
		if (!firstName && !ssn) continue;
		const status = asText(key('status'));
		const birthYear = key('birth_year') === undefined ? null : asNumber(key('birth_year'));
		const monthsLived = key('months_lived') === undefined ? null : asNumber(key('months_lived'));
		dependentDetails.push({
			firstName,
			lastName: asText(key('last_name')),
			ssn,
			relationship: asText(key('relationship')),
			birthYear: birthYear && birthYear > 0 ? birthYear : null,
			monthsLived,
			status: status === 'student' || status === 'disabled' ? status : 'none'
		});
	}

	const input: ReturnInput = {
		year,
		filingStatus,
		identity: {
			firstName: asText(book.get('taxpayer_first_name')),
			lastName: asText(book.get('taxpayer_last_name')),
			ssn: asText(book.get('taxpayer_ssn')),
			spouseFirstName: asText(book.get('spouse_first_name')),
			spouseLastName: asText(book.get('spouse_last_name')),
			spouseSsn: asText(book.get('spouse_ssn')),
			street: asText(book.get('address_street')),
			apt: asText(book.get('address_apt')),
			city: asText(book.get('address_city')),
			state: asText(book.get('address_state')),
			zip: asText(book.get('address_zip')),
			occupation: asText(book.get('taxpayer_occupation')),
			spouseOccupation: asText(book.get('spouse_occupation'))
		},
		dependents,
		qualifyingChildren: asNumber(book.get('qualifying_children')),
		dependentDetails,
		additionalDeductionBoxes: asNumber(book.get('age_65_or_blind')),
		wages,
		socialSecurityWages,
		medicareWages,
		interest: { taxable: payersOf(categoryOn(scheduleB, '1')), taxExempt: reported(taxExempt) },
		dividends: {
			ordinary: payersOf(ordinaryDividends),
			qualified: reported(qualifiedDividends),
			ordinaryIncludesQualified: ordinaryDividends?.documentTotal !== null && ordinaryDividends?.documentTotal !== undefined
		},
		retirement,
		capitalGains: { shortTerm: reported(categoryOn(scheduleD, '1')), longTerm: reported(categoryOn(scheduleD, '8')) },
		unemployment,
		stateRefund,
		scheduleENet: scheduleE?.reportedNet ?? 0,
		schedule1: schedule1Lines,
		businesses,
		itemized: {
			medical: reported(categoryOn(scheduleA, '1')),
			stateLocalIncomeTaxes: reported(categoryOn(scheduleA, '5a')),
			realEstateTaxes: reported(categoryOn(scheduleA, '5b')),
			personalPropertyTaxes: reported(categoryOn(scheduleA, '5c')),
			mortgageInterest: reported(categoryOn(scheduleA, '8a')),
			charityCash: reported(categoryOn(scheduleA, '11')),
			charityNonCash: reported(categoryOn(scheduleA, '12'))
		},
		withholding,
		estimatedPayments: asNumber(book.get('federal_estimated_payments')),
		extensionPayment: book.get('extension_filed') === true ? asNumber(book.get('extension_payment')) : 0,
		notes
	};

	return { available: true, computation: computeReturn(input, constants), input };
}
