import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runMpWithBook, runMpJsonWithBook, createTestBook, deleteTestBook, resetTestBookId } from './setup';

interface Account {
	id: string;
	type: string;
	path: string;
}

interface TaxCategory {
	id: string;
	name: string;
}

interface TaxDocument {
	id: string;
	year: number;
	formType: string;
	issuer: string;
	status: string;
	lines: { id: string; box: string; label: string; amount: string; taxCategoryId: string | null }[];
}

interface DocumentLine {
	id: string;
	box: string;
	label: string;
	amount: string;
	taxCategoryId: string | null;
}

interface TaxFact {
	id: string;
	year: number | null;
	key: string;
	value: unknown;
}

interface TaxYearStatus {
	year: number;
	modules: { moduleId: string; questions: { key: string; answered: boolean; visible: boolean; answer: unknown }[] }[];
	expectedDocuments: { formType: string; institution: string; status: string; accountIds: string[] }[];
	openQuestions: number;
	missingDocuments: number;
}

interface TaxReport {
	sections: {
		schedule: string;
		hasDocuments: boolean;
		incomeCategories: { taxCategoryName: string; total: number; documentTotal: number | null; reportedTotal: number }[];
		expenseCategories: { taxCategoryName: string; total: number; documentTotal: number | null; reportedTotal: number }[];
		totalIncome: number;
		reportedIncome: number;
	}[];
	openQuestions: number;
	missingDocuments: number;
	unmappedDocumentLines: number;
}

let bookId: string;
let checking: Account;
let brokerage: Account;
let interestIncome: Account;
let interestCategory: TaxCategory;

beforeAll(() => {
	bookId = createTestBook('Tax Year Tests');
	runMpWithBook('module:enable us-personal-base', bookId);
	const categories = runMpJsonWithBook<TaxCategory[]>('tax:list', bookId);
	interestCategory = categories.find((c) => c.name === 'Interest Income')!;

	checking = runMpJsonWithBook<Account>('account:create --type asset --path "Ally:Checking" --asset-type liquid', bookId);
	brokerage = runMpJsonWithBook<Account>('account:create --type asset --path "Vanguard:Brokerage" --asset-type brokerage', bookId);
	interestIncome = runMpJsonWithBook<Account>(
		`account:create --type income --path "Interest" --tax-category ${interestCategory.id}`,
		bookId
	);

	// Interest received in checking, and a withdrawal from the brokerage
	runMpWithBook(
		`tx:create --date 2025-03-01 --description "Interest" --amount 400 --debit ${checking.id} --credit ${interestIncome.id}`,
		bookId
	);
	runMpWithBook(
		`tx:create --date 2025-06-01 --description "Sale proceeds" --amount 5000 --debit ${checking.id} --credit ${brokerage.id}`,
		bookId
	);
});

afterAll(() => {
	deleteTestBook(bookId);
	resetTestBookId();
});

describe('Tax facts', () => {
	it('parses and stores a choice answer for the year', () => {
		const { stdout } = runMpWithBook('fact:set filing_status mfj --year 2025', bookId);
		expect(stdout).toContain('Set filing_status = mfj for 2025');

		const fact = runMpJsonWithBook<TaxFact>('fact:get filing_status --year 2025', bookId);
		expect(fact.value).toBe('mfj');
		expect(fact.year).toBe(2025);
	});

	it('rejects an invalid choice', () => {
		const { exitCode, stderr } = runMpWithBook('fact:set filing_status married --year 2025', bookId);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('Expected one of');
	});

	it('parses booleans and amounts by question type', () => {
		runMpWithBook('fact:set extension_filed yes --year 2025', bookId);
		runMpWithBook('fact:set extension_payment 1,250.50 --year 2025', bookId);

		expect(runMpJsonWithBook<TaxFact>('fact:get extension_filed --year 2025', bookId).value).toBe(true);
		expect(runMpJsonWithBook<TaxFact>('fact:get extension_payment --year 2025', bookId).value).toBe(1250.5);
	});

	it('stores carry-forward questions without a year and finds them from any year', () => {
		runMpWithBook('fact:set roth_basis 30000 --year 2025', bookId);
		const fact = runMpJsonWithBook<TaxFact>('fact:get roth_basis --year 2026', bookId);
		expect(fact.year).toBeNull();
		expect(fact.value).toBe(30000);
	});

	it('updates an existing fact in place', () => {
		runMpWithBook('fact:set filing_status single --year 2025', bookId);
		expect(runMpJsonWithBook<TaxFact>('fact:get filing_status --year 2025', bookId).value).toBe('single');
	});

	it('lists questions with answers', () => {
		const { stdout } = runMpWithBook('fact:list --year 2025', bookId);
		expect(stdout).toContain('filing_status');
		expect(stdout).toContain('= single');
		expect(stdout).toContain('(unanswered)');
		expect(stdout).toContain('roth_basis');
		expect(stdout).toContain('(carry-forward)');
	});

	it('hides dependent questions until the condition holds', () => {
		runMpWithBook('fact:set extension_filed no --year 2025', bookId);
		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		const questions = status.modules.flatMap((m) => m.questions);
		expect(questions.find((q) => q.key === 'extension_payment')!.visible).toBe(false);
		runMpWithBook('fact:set extension_filed yes --year 2025', bookId);
	});

	it('deletes a fact and can undo it', () => {
		runMpWithBook('fact:set dependents 2 --year 2025', bookId);
		const { stdout } = runMpWithBook('fact:delete dependents --year 2025', bookId);
		expect(stdout).toContain('Deleted fact dependents');
		expect(runMpWithBook('fact:get dependents --year 2025', bookId).exitCode).not.toBe(0);

		const { stdout: log } = runMpWithBook('log:list --limit 1', bookId);
		const logId = log.trim().split(/\s+/)[0];
		runMpWithBook(`log:undo ${logId}`, bookId);
		expect(runMpJsonWithBook<TaxFact>('fact:get dependents --year 2025', bookId).value).toBe(2);
	});
});

describe('Expected documents', () => {
	it('infers 1099-INT and 1099-B from the year’s transactions', () => {
		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		const int = status.expectedDocuments.find((d) => d.formType === '1099-INT');
		const b = status.expectedDocuments.find((d) => d.formType === '1099-B');
		expect(int?.institution).toBe('Ally');
		expect(int?.accountIds).toContain(checking.id);
		expect(int?.status).toBe('missing');
		expect(b?.institution).toBe('Vanguard');
		expect(status.missingDocuments).toBe(2);
	});

	it('expects a W-2 once the wages question is answered yes', () => {
		runMpWithBook('fact:set w2_wages yes --year 2025', bookId);
		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.some((d) => d.formType === 'W-2' && d.status === 'missing')).toBe(true);
	});

	it('marks an expectation satisfied by a document from the same institution', () => {
		runMpJsonWithBook<TaxDocument>('doc:add --form 1099-int --issuer "Ally Bank" --year 2025', bookId);
		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.find((d) => d.formType === '1099-INT')?.status).toBe('received');
	});

	it('marks an expectation not applicable', () => {
		runMpJsonWithBook<TaxDocument>(`doc:add --form 1099-B --issuer Vanguard --year 2025 --account ${brokerage.id} --na`, bookId);
		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.find((d) => d.formType === '1099-B')?.status).toBe('not_applicable');
	});
});

describe('Tax documents', () => {
	let doc: TaxDocument;

	beforeAll(() => {
		const docs = runMpJsonWithBook<TaxDocument[]>('doc:list --year 2025', bookId);
		doc = docs.find((d) => d.formType === '1099-INT')!;
	});

	it('normalizes the form type', () => {
		expect(doc.formType).toBe('1099-INT');
	});

	it('adds a line with the preset label and a guessed category', () => {
		const line = runMpJsonWithBook<DocumentLine>(`doc:line ${doc.id} --box 1 --amount 412.34`, bookId);
		expect(line.label).toBe('Interest income');
		expect(line.taxCategoryId).toBe(interestCategory.id);
	});

	it('replaces a line with the same box', () => {
		runMpJsonWithBook<DocumentLine>(`doc:line ${doc.id} --box 1 --amount 450`, bookId);
		const fetched = runMpJsonWithBook<TaxDocument>(`doc:get ${doc.id}`, bookId);
		expect(fetched.lines.filter((l) => l.box === '1').length).toBe(1);
		expect(parseFloat(fetched.lines[0].amount)).toBe(450);
	});

	it('accepts a category by name and leaves unknown boxes unmapped', () => {
		const byName = runMpJsonWithBook<DocumentLine>(
			`doc:line ${doc.id} --box 3 --amount 10 --category "Interest Income"`,
			bookId
		);
		expect(byName.taxCategoryId).toBe(interestCategory.id);

		const unmapped = runMpJsonWithBook<DocumentLine>(`doc:line ${doc.id} --box 99 --amount 5 --label "Something"`, bookId);
		expect(unmapped.taxCategoryId).toBeNull();
		expect(unmapped.label).toBe('Something');
	});

	it('overrides the book total in the tax report', () => {
		const report = runMpJsonWithBook<TaxReport>('tax:report --year 2025', bookId);
		const scheduleB = report.sections.find((s) => s.schedule === 'Schedule B')!;
		const interest = scheduleB.incomeCategories.find((c) => c.taxCategoryName === 'Interest Income')!;
		expect(interest.total).toBe(400);
		expect(interest.documentTotal).toBe(460);
		expect(interest.reportedTotal).toBe(460);
		expect(scheduleB.hasDocuments).toBe(true);
		expect(scheduleB.totalIncome).toBe(400);
		expect(scheduleB.reportedIncome).toBe(460);
		expect(report.unmappedDocumentLines).toBe(1);
		expect(report.missingDocuments).toBe(1);
	});

	it('shows document-only categories in the report', () => {
		const categories = runMpJsonWithBook<TaxCategory[]>('tax:list', bookId);
		const longTerm = categories.find((c) => c.name === 'Capital Gains - Long Term')!;
		const b = runMpJsonWithBook<TaxDocument>('doc:add --form 1099-B --issuer Betterment --year 2025', bookId);
		runMpJsonWithBook<DocumentLine>(`doc:line ${b.id} --box LT --amount 1234.56 --category ${longTerm.id}`, bookId);

		const report = runMpJsonWithBook<TaxReport>('tax:report --year 2025', bookId);
		const scheduleD = report.sections.find((s) => s.schedule === 'Schedule D')!;
		const gains = scheduleD.incomeCategories.find((c) => c.taxCategoryName === 'Capital Gains - Long Term')!;
		expect(gains.total).toBe(0);
		expect(gains.documentTotal).toBe(1234.56);
	});

	it('ignores lines on not-applicable documents', () => {
		const docs = runMpJsonWithBook<TaxDocument[]>('doc:list --year 2025', bookId);
		const na = docs.find((d) => d.status === 'NOT_APPLICABLE')!;
		runMpJsonWithBook<DocumentLine>(`doc:line ${na.id} --box LT --amount 999 --category "Capital Gains - Long Term"`, bookId);
		const report = runMpJsonWithBook<TaxReport>('tax:report --year 2025', bookId);
		const scheduleD = report.sections.find((s) => s.schedule === 'Schedule D')!;
		expect(scheduleD.incomeCategories.find((c) => c.taxCategoryName === 'Capital Gains - Long Term')!.documentTotal).toBe(1234.56);
	});

	it('deletes lines and documents', () => {
		const fetched = runMpJsonWithBook<TaxDocument>(`doc:get ${doc.id}`, bookId);
		const line = fetched.lines.find((l) => l.box === '99')!;
		expect(runMpWithBook(`doc:line-delete ${line.id}`, bookId).stdout).toContain('Deleted line');

		expect(runMpWithBook(`doc:delete ${doc.id}`, bookId).stdout).toContain('Deleted document');
		expect(runMpWithBook(`doc:get ${doc.id}`, bookId).exitCode).not.toBe(0);

		const status = runMpJsonWithBook<TaxYearStatus>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.find((d) => d.formType === '1099-INT')?.status).toBe('missing');
	});

	it('round-trips documents and facts through export and import', () => {
		const file = `/tmp/moneypit-tax-year-${Date.now()}.json`;
		runMpWithBook(`book:export ${file}`, bookId);
		const { stdout } = runMpWithBook(`book:import ${file} --name "Tax Year Import ${Date.now()}"`, bookId);
		expect(stdout).toMatch(/Tax Documents: 2/);
		expect(stdout).toMatch(/Tax Facts: \d+/);
		const importedId = stdout.match(/\(([a-z0-9]+)\)/)![1];
		const docs = runMpJsonWithBook<TaxDocument[]>('doc:list --year 2025', importedId);
		expect(docs.length).toBe(2);
		expect(runMpJsonWithBook<TaxFact>('fact:get filing_status --year 2025', importedId).value).toBe('single');
		deleteTestBook(importedId);
	});
});
