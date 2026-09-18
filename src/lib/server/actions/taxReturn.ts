import { getTaxReportData, type ScheduleSection, type TaxCategoryTotal } from './reports';
import { getTaxYearStatus, type TaxYearStatus } from './taxYear';
import { normalizeFormType } from '$lib/taxForms';
import { computeReturn, type BusinessInput, type DependentInput, type PayerFigure, type ReturnComputation, type ReturnInput, type ScheduleLineFigure } from '../taxReturn/compute';
import { rowsFromDocument, type CapitalGainRow } from '../taxReturn/form8949';
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
const round2 = (n: number) => Math.round(n * 100) / 100 || 0;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Assemble the return's input from the tax report, the questionnaire, and
 * the documents on hand, then compute it. Figures follow the report exactly:
 * a category's reported total is what lands on its line.
 */
export async function getTaxReturn(bookId: string, year: number): Promise<TaxReturnResult> {
	const constants = getTaxYearConstants(year);
	if (!constants) {
		return {
			available: false,
			reason: `No tax tables for ${year}: the draft return needs that year's brackets, standard deduction and credit figures, which the IRS publishes in the autumn before it. To add them, put a ${year} table in src/lib/server/taxReturn/constants.ts; for the filled PDF, also download the ${year} fillable forms into forms/irs/${year}/ and map their fields in src/lib/server/taxReturn/pdf.ts.`,
			supportedYears: supportedTaxYears()
		};
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
	notes.push(...report.worksheetWarnings);
	// Documents: wages, withholding, and forms whose boxes have no category
	const docs = status.documents.filter((d) => d.status === 'RECEIVED');
	let wages = 0;
	let socialSecurityWages = 0;
	let medicareWages = 0;
	const withholding = { w2: 0, forms1099: 0 };
	const retirement = { gross: 0, taxable: 0, rothDistributions: 0, rothBasis: asNumber(book.get('roth_basis')) };
	let unemployment = 0;
	let stateRefund = 0;
	// Form 8949 rows from the 1099-Bs, and the net gain each box's line puts in a category (subtracted below so it is not counted twice)
	const capitalGainRows: CapitalGainRow[] = [];
	const rowGainsByCategory = new Map<string, number>();
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
				if (doc.account?.assetType === 'ROTH_RETIREMENT') {
					// A Roth IRA distribution: Form 8606 Part III figures the taxable part from the basis answer, not box 2a
					if (gross && !gross.mapped) retirement.rothDistributions += gross.amount;
					if (taxable && taxable.amount !== 0) {
						notes.push(
							`1099-R from ${doc.issuer} is a Roth IRA distribution (its account is a Roth IRA), so Form 8606 figures the taxable amount; box 2a (${money(taxable.amount)}) is ${taxable.mapped ? 'mapped to a tax category and reaches line 4b through the report on top of it; unmap or delete the line' : 'ignored'}.`
						);
					}
				} else if (taxable && !taxable.mapped) retirement.taxable += taxable.amount;
				else if (gross && !gross.mapped && !taxable) {
					retirement.taxable += gross.amount;
					notes.push(`1099-R from ${doc.issuer} has no box 2a; the gross distribution was treated as fully taxable.`);
				}
			} else if (form === '1099-G') {
				const b1 = box('1');
				const b2 = box('2');
				if (b1 && !b1.mapped) unemployment += b1.amount;
				if (b2 && !b2.mapped) stateRefund += b2.amount;
			} else if (form === '1099-B') {
				const parsed = rowsFromDocument(doc.issuer, doc.lines.map((l) => ({ id: l.id, box: l.box, amount: Number(l.amount), taxCategoryId: l.taxCategoryId })));
				for (const lineId of parsed.consumed) consumed.add(lineId);
				for (const { row, gainLine } of parsed.rows) {
					capitalGainRows.push(row);
					if (gainLine?.taxCategoryId) {
						rowGainsByCategory.set(gainLine.taxCategoryId, round2((rowGainsByCategory.get(gainLine.taxCategoryId) ?? 0) + gainLine.amount));
					} else {
						notes.push(
							`1099-B from ${doc.issuer}, box ${row.box}: ${gainLine ? 'the net gain or loss line has no tax category' : 'no net gain or loss line is entered'}, so the tax report leaves it out; Form 8949 and Schedule D have it.`
						);
					}
				}
			}
		} else if (form === 'K-1') {
			// The categorized boxes reach their lines through the report; these three have no line on the return
			const portfolio = box('13AE');
			if (portfolio && portfolio.amount !== 0) {
				notes.push(
					`Schedule K-1 from ${doc.issuer}: box 13 code AE portfolio deductions of ${money(portfolio.amount)} are not deductible federally (miscellaneous itemized deductions are suspended)${portfolio.mapped ? ', but the line is mapped to a tax category; unmap it so the report leaves it out' : ', so they are left off the return'}.`
				);
			}
			box('20A');
			box('20B');
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
	const form6781 = sectionsOf('Form 6781')[0];
	const partnershipIncome = reported(categoryOn(scheduleE, '28'));
	if (partnershipIncome !== 0) {
		notes.push(
			`Partnership income of ${money(partnershipIncome)} (Schedule K-1 boxes 1 to 3) is carried to Schedule 1 line 5 in full; Schedule E page 2 is not produced and the passive activity loss rules for publicly traded partnerships are not applied.`
		);
	}
	// A 1099-R box 2a mapped to a category reaches line 4b through the report
	retirement.taxable += reported(categoryOn(form1040, '4b'));
	if (retirement.rothDistributions > 0 && !book.has('roth_basis')) {
		notes.push(`Roth IRA distributions of ${money(retirement.rothDistributions)} are entered but "Total Roth IRA contributions to date (basis)" is unanswered, so Form 8606 treats the whole amount as taxable.`);
	}

	const taxExempt = report.nonDeductible.income.find((c) => c.taxCategoryName === 'Tax Exempt');
	const netOnly = (category: TaxCategoryTotal | undefined) => round2(reported(category) - (category?.taxCategoryId ? (rowGainsByCategory.get(category.taxCategoryId) ?? 0) : 0));
	const ordinaryDividends = categoryOn(scheduleB, '6');
	const qualifiedDividends = categoryOn(scheduleB, '5');

	const businesses: BusinessInput[] = sectionsOf('Schedule C').map((section) => {
		const answers = answersFor(status, section.businessId);
		const figures = (categories: TaxCategoryTotal[]): ScheduleLineFigure[] =>
			categories
				.map((c) => ({ line: lineOf(c.scheduleRef) ?? '', category: c.taxCategoryName, amount: c.reportedTotal }))
				.filter((f) => f.line !== '' && f.amount !== 0);
		const method = asText(answers.get('accounting_method'));
		// The home office worksheet already deducted last year's carryover and figured this year's
		const homeOffice = report.worksheets.find((w) => w.worksheetId === 'home-office' && w.businessId === section.businessId);
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
			sepContribution: asNumber(answers.get('sep_contribution')),
			homeOfficeCarryover: {
				fromLastYear: asNumber(answers.get('home_office_carryover')),
				toNextYear: homeOffice?.breakdown.find((r) => r.kind === 'carryover')?.amount ?? 0
			}
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
		capitalGains: {
			// What is left of each category once the Form 8949 rows' net figures are taken out: book transactions and net-only document lines
			shortTerm: netOnly(categoryOn(scheduleD, '1')),
			longTerm: netOnly(categoryOn(scheduleD, '8')),
			distributions: reported(categoryOn(scheduleD, '13')),
			partnershipShort: reported(categoryOn(scheduleD, '5')),
			partnershipLong: reported(categoryOn(scheduleD, '12')),
			rows: capitalGainRows
		},
		section1256: payersOf(categoryOn(form6781, '1')),
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
		carryovers: {
			capitalLossShort: asNumber(book.get('capital_loss_carryover_short')),
			capitalLossLong: asNumber(book.get('capital_loss_carryover_long')),
			qbiLoss: asNumber(book.get('qbi_loss_carryforward')),
			nol: asNumber(book.get('nol_carryforward'))
		},
		notes
	};

	return { available: true, computation: computeReturn(input, constants), input };
}
