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

interface TaxReportCategory {
	taxCategoryName: string;
	total: number;
	documentTotal: number | null;
	reportedTotal: number;
	accounts: { id: string; total: number; share: number }[];
	worksheets: { worksheetId: string; amount: number }[];
}

interface TaxReport {
	sections: {
		schedule: string;
		hasDocuments: boolean;
		incomeCategories: TaxReportCategory[];
		expenseCategories: TaxReportCategory[];
		totalIncome: number;
		reportedIncome: number;
	}[];
	worksheetWarnings: string[];
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

describe('Document files', () => {
	interface DocumentFile {
		id: string;
		filename: string;
		mimeType: string;
		size: number;
	}
	interface DocumentWithFile extends TaxDocument {
		file: DocumentFile | null;
		lines: (TaxDocument['lines'][number] & { page: number | null; x: number | null })[];
	}

	let doc: TaxDocument;

	beforeAll(() => {
		doc = runMpJsonWithBook<TaxDocument>('doc:add --form 1099-int --issuer "Ally Bank" --year 2024', bookId);
	});

	it('attaches a PDF and reports it on the document', () => {
		const file = runMpJsonWithBook<DocumentFile>(`doc:attach ${doc.id} test/fixtures/1099-int.pdf`, bookId);
		expect(file.filename).toBe('1099-int.pdf');
		expect(file.mimeType).toBe('application/pdf');
		expect(file.size).toBeGreaterThan(1000);

		const fetched = runMpJsonWithBook<DocumentWithFile>(`doc:get ${doc.id}`, bookId);
		expect(fetched.file?.id).toBe(file.id);
		// Bytes stay out of the listing
		expect(JSON.stringify(fetched)).not.toContain('"data"');
	});

	it('replaces the file with an image, with a fresh id', () => {
		const before = runMpJsonWithBook<DocumentWithFile>(`doc:get ${doc.id}`, bookId).file!;
		const file = runMpJsonWithBook<DocumentFile>(`doc:attach ${doc.id} test/fixtures/1099-int.png`, bookId);
		expect(file.mimeType).toBe('image/png');
		expect(file.id).not.toBe(before.id);
	});

	it('rejects files that are not a PDF or image', () => {
		const result = runMpWithBook(`doc:attach ${doc.id} test/fixtures/chase-checking.csv`, bookId);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr + result.stdout).toMatch(/Unsupported file type/);
	});

	it('carries the file and line regions through export and import', () => {
		runMpJsonWithBook<DocumentLine>(`doc:line ${doc.id} --box 1 --amount 412.34`, bookId);
		const file = `/tmp/moneypit-doc-file-${Date.now()}.json`;
		runMpWithBook(`book:export ${file}`, bookId);
		const { stdout } = runMpWithBook(`book:import ${file} --name "Doc File Import ${Date.now()}"`, bookId);
		const importedId = stdout.match(/\(([a-z0-9]+)\)/)![1];
		const docs = runMpJsonWithBook<DocumentWithFile[]>('doc:list --year 2024', importedId);
		const imported = docs.find((d) => d.issuer === 'Ally Bank')!;
		expect(imported.file?.filename).toBe('1099-int.png');
		expect(imported.file?.size).toBe(runMpJsonWithBook<DocumentWithFile>(`doc:get ${doc.id}`, bookId).file!.size);
		expect(imported.lines[0].box).toBe('1');
		deleteTestBook(importedId);
	});

	it('detaches the file and clears line regions', () => {
		expect(runMpWithBook(`doc:detach ${doc.id}`, bookId).stdout).toContain('Removed file');
		const fetched = runMpJsonWithBook<DocumentWithFile>(`doc:get ${doc.id}`, bookId);
		expect(fetched.file).toBeNull();
		expect(fetched.lines.length).toBe(1);
		expect(fetched.lines[0].page).toBeNull();
		expect(runMpWithBook(`doc:detach ${doc.id}`, bookId).exitCode).not.toBe(0);
	});

	it('removes the file with the document', () => {
		runMpJsonWithBook<DocumentFile>(`doc:attach ${doc.id} test/fixtures/1099-int.pdf`, bookId);
		runMpWithBook(`doc:delete ${doc.id}`, bookId);
		expect(runMpWithBook(`doc:get ${doc.id}`, bookId).exitCode).not.toBe(0);
	});
});

describe('Businesses', () => {
	interface Business {
		id: string;
		name: string;
		accountCount: number;
	}
	interface BusinessDetail extends Business {
		accounts: { id: string; path: string; percent: number }[];
	}
	interface StatusWithBusinesses extends TaxYearStatus {
		businesses: { id: string; name: string }[];
		modules: (TaxYearStatus['modules'][number] & { businessId: string | null; businessName: string | null })[];
		expectedDocuments: (TaxYearStatus['expectedDocuments'][number] & { businessId: string | null })[];
	}
	interface ReportWithBusinesses extends TaxReport {
		sections: (TaxReport['sections'][number] & { key: string; businessId: string | null; businessName: string | null; unassigned: boolean })[];
	}

	let consulting: Account;
	let ads: Account;
	let betaSales: Account;
	let alpha: Business;
	let beta: Business;

	const scheduleC = (report: ReportWithBusinesses) => report.sections.filter((s) => s.schedule === 'Schedule C');
	const scheduleCModules = (status: StatusWithBusinesses) => status.modules.filter((m) => m.moduleId === 'us-schedule-c');

	beforeAll(() => {
		runMpWithBook('module:enable us-schedule-c', bookId);
		const categories = runMpJsonWithBook<TaxCategory[]>('tax:list', bookId);
		const receipts = categories.find((c) => c.name === 'Gross Receipts')!;
		const advertising = categories.find((c) => c.name === 'Advertising')!;

		consulting = runMpJsonWithBook<Account>(`account:create --type income --path "Consulting" --tax-category ${receipts.id}`, bookId);
		ads = runMpJsonWithBook<Account>(`account:create --type expense --path "Ads" --tax-category ${advertising.id}`, bookId);
		runMpWithBook(`tx:create --date 2025-02-01 --description "Client" --amount 1000 --debit ${checking.id} --credit ${consulting.id}`, bookId);
		runMpWithBook(`tx:create --date 2025-03-01 --description "Google Ads" --amount 200 --debit ${ads.id} --credit ${checking.id}`, bookId);

		// Answered while the book still had a single implicit business
		runMpWithBook('fact:set business_owner taxpayer', bookId);
	});

	it('treats a book with no businesses as one Schedule C', () => {
		const status = runMpJsonWithBook<StatusWithBusinesses>('tax:status --year 2025 --json', bookId);
		expect(status.businesses).toEqual([]);
		const modules = scheduleCModules(status);
		expect(modules.length).toBe(1);
		expect(modules[0].businessId).toBeNull();
		expect(modules[0].questions.find((q) => q.key === 'business_owner')!.answer).toBe('taxpayer');

		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		expect(scheduleC(report).length).toBe(1);
		expect(scheduleC(report)[0].businessId).toBeNull();
	});

	it('first business adopts existing Schedule C accounts and answers', () => {
		const { stdout } = runMpWithBook('business:create Alpha', bookId);
		expect(stdout).toContain('Created business Alpha');
		expect(stdout).toContain('Adopted 2 account(s) and 1 answer(s)');

		alpha = runMpJsonWithBook<Business[]>('business:list', bookId)[0];
		expect(alpha.name).toBe('Alpha');
		expect(alpha.accountCount).toBe(2);

		const detail = runMpJsonWithBook<BusinessDetail>('business:get Alpha', bookId);
		expect(detail.accounts.map((a) => [a.path, a.percent]).sort()).toEqual([
			['Ads', 100],
			['Consulting', 100]
		]);

		const fact = runMpJsonWithBook<TaxFact>(`fact:get business_owner --year 2025 --business ${alpha.id}`, bookId);
		expect(fact.value).toBe('taxpayer');
	});

	it('asks per-business questions once per business', () => {
		const { stdout } = runMpWithBook('business:create Beta', bookId);
		expect(stdout).not.toContain('Adopted');
		beta = runMpJsonWithBook<Business[]>('business:list', bookId).find((b) => b.name === 'Beta')!;

		runMpWithBook('fact:set business_owner spouse --business Beta', bookId);
		const status = runMpJsonWithBook<StatusWithBusinesses>('tax:status --year 2025 --json', bookId);
		const modules = scheduleCModules(status);
		expect(modules.map((m) => m.businessName)).toEqual(['Alpha', 'Beta']);
		expect(modules[0].questions.find((q) => q.key === 'business_owner')!.answer).toBe('taxpayer');
		expect(modules[1].questions.find((q) => q.key === 'business_owner')!.answer).toBe('spouse');
		// Book-level modules are still asked once
		expect(status.modules.filter((m) => m.moduleId === 'us-personal-base').length).toBe(1);
	});

	it('requires a business for per-business questions once one exists', () => {
		const { exitCode, stderr } = runMpWithBook('fact:set accounting_method cash', bookId);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('answered per business');

		const wrong = runMpWithBook('fact:set filing_status mfj --year 2025 --business Alpha', bookId);
		expect(wrong.exitCode).not.toBe(0);
		expect(wrong.stderr).toContain('not a per-business question');
	});

	it('splits the Schedule C report by business', () => {
		const categories = runMpJsonWithBook<TaxCategory[]>('tax:list', bookId);
		const receipts = categories.find((c) => c.name === 'Gross Receipts')!;
		betaSales = runMpJsonWithBook<Account>(
			`account:create --type income --path "Beta Sales" --tax-category ${receipts.id} --business Beta`,
			bookId
		);
		runMpWithBook(`tx:create --date 2025-04-01 --description "Sale" --amount 300 --debit ${checking.id} --credit ${betaSales.id}`, bookId);

		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		const sections = scheduleC(report);
		expect(sections.map((s) => s.businessName)).toEqual(['Alpha', 'Beta']);
		expect(sections[0].totalIncome).toBe(1000);
		expect(sections[0].expenseCategories.find((c) => c.taxCategoryName === 'Advertising')!.total).toBe(200);
		expect(sections[1].totalIncome).toBe(300);
		expect(sections[1].expenseCategories.length).toBe(0);
		// Schedule B is not split
		expect(report.sections.filter((s) => s.schedule === 'Schedule B').length).toBe(1);
	});

	it('flags Schedule C accounts with no business', () => {
		runMpWithBook(`account:update ${betaSales.id} --business null`, bookId);
		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		const unassigned = scheduleC(report).find((s) => s.unassigned)!;
		expect(unassigned.businessId).toBeNull();
		expect(unassigned.totalIncome).toBe(300);
		expect(scheduleC(report).map((s) => s.businessName)).toEqual(['Alpha', null]);

		runMpWithBook(`business:assign Beta ${betaSales.id}`, bookId);
		expect(scheduleC(runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId)).some((s) => s.unassigned)).toBe(false);
	});

	it('splits an account attached to two businesses by percentage', () => {
		// Ads (200) is Alpha's; give Beta 40% of it too, leaving Alpha 60%
		runMpWithBook(`business:assign Alpha ${ads.id} --percent 60`, bookId);
		runMpWithBook(`business:assign Beta ${ads.id} --percent 40`, bookId);
		const { stdout } = runMpWithBook('account:list --condensed', bookId);
		expect(stdout).toMatch(/Ads\t\[Alpha 60%, Beta 40%\]/);

		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		const [alphaSection, betaSection] = scheduleC(report);
		const alphaAds = alphaSection.expenseCategories.find((c) => c.taxCategoryName === 'Advertising')!;
		const betaAds = betaSection.expenseCategories.find((c) => c.taxCategoryName === 'Advertising')!;
		expect(alphaAds.total).toBe(120);
		expect(alphaAds.accounts[0].share).toBe(0.6);
		expect(betaAds.total).toBe(80);
		expect(report.worksheetWarnings).toEqual([]);

		// More than the whole account across businesses is flagged
		runMpWithBook(`business:assign Beta ${ads.id} --percent 50`, bookId);
		const over = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		expect(over.worksheetWarnings).toEqual(['110% of Ads is claimed across Alpha 60%, Beta 50%; the shares add up to more than the whole account.']);

		runMpWithBook(`business:unassign Beta ${ads.id}`, bookId);
		runMpWithBook(`business:assign Alpha ${ads.id}`, bookId);
		expect(runMpJsonWithBook<BusinessDetail>('business:get Alpha', bookId).accounts.find((a) => a.id === ads.id)!.percent).toBe(100);
	});

	it('puts the business share of an attached personal account on Schedule C line 25', () => {
		const phone = runMpJsonWithBook<Account>('account:create --type expense --path "Phone"', bookId);
		runMpWithBook(`tx:create --date 2025-05-01 --description "Carrier" --amount 1000 --debit ${phone.id} --credit ${checking.id}`, bookId);
		runMpWithBook(`business:assign Beta ${phone.id} --percent 30`, bookId);

		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		const betaSection = scheduleC(report).find((s) => s.businessName === 'Beta')!;
		const utilities = betaSection.expenseCategories.find((c) => c.taxCategoryName === 'Utilities')!;
		expect(utilities.reportedTotal).toBe(300);
		expect(utilities.worksheets.map((w) => w.worksheetId)).toEqual(['shared-use']);
		expect(report.worksheetWarnings).toEqual([]);
		// The account itself is not on the section's own categories
		expect(scheduleC(report).find((s) => s.businessName === 'Alpha')!.expenseCategories.some((c) => c.taxCategoryName === 'Utilities')).toBe(false);

		runMpWithBook(`business:unassign Beta ${phone.id}`, bookId);
		expect(
			scheduleC(runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId))
				.find((s) => s.businessName === 'Beta')!
				.expenseCategories.some((c) => c.taxCategoryName === 'Utilities')
		).toBe(false);
	});

	it('expects and matches per-business documents', () => {
		runMpWithBook('fact:set received_1099_nec yes --year 2025 --business Beta', bookId);
		let status = runMpJsonWithBook<StatusWithBusinesses>('tax:status --year 2025 --json', bookId);
		const expected = status.expectedDocuments.find((d) => d.formType === '1099-NEC')!;
		expect(expected.businessId).toBe(beta.id);
		expect(expected.status).toBe('missing');

		// A 1099-NEC filed under the other business doesn't satisfy it
		runMpJsonWithBook<TaxDocument>('doc:add --form 1099-NEC --issuer "Some Client" --year 2025 --business Alpha', bookId);
		status = runMpJsonWithBook<StatusWithBusinesses>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.find((d) => d.formType === '1099-NEC')!.status).toBe('missing');

		const doc = runMpJsonWithBook<TaxDocument & { business: { name: string } | null }>(
			'doc:add --form 1099-NEC --issuer "Beta Client" --year 2025 --business Beta',
			bookId
		);
		expect(doc.business?.name).toBe('Beta');
		status = runMpJsonWithBook<StatusWithBusinesses>('tax:status --year 2025 --json', bookId);
		expect(status.expectedDocuments.find((d) => d.formType === '1099-NEC')!.status).toBe('received');

		// Its lines overlay only that business's section
		runMpJsonWithBook<DocumentLine>(`doc:line ${doc.id} --box 1 --amount 350 --category "Gross Receipts"`, bookId);
		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		const [alphaSection, betaSection] = scheduleC(report);
		expect(alphaSection.incomeCategories.find((c) => c.taxCategoryName === 'Gross Receipts')!.documentTotal).toBeNull();
		expect(betaSection.incomeCategories.find((c) => c.taxCategoryName === 'Gross Receipts')!.documentTotal).toBe(350);
		expect(betaSection.reportedIncome).toBe(350);
	});

	it('round-trips businesses through export and import', () => {
		const file = `/tmp/moneypit-businesses-${Date.now()}.json`;
		runMpWithBook(`book:export ${file}`, bookId);
		const { stdout } = runMpWithBook(`book:import ${file} --name "Business Import ${Date.now()}"`, bookId);
		expect(stdout).toMatch(/Businesses: 2/);
		const importedId = stdout.match(/\(([a-z0-9]+)\)/)![1];

		const imported = runMpJsonWithBook<Business[]>('business:list', importedId);
		expect(imported.map((b) => [b.name, b.accountCount])).toEqual([
			['Alpha', 2],
			['Beta', 1]
		]);
		const importedBeta = imported.find((b) => b.name === 'Beta')!;
		expect(runMpJsonWithBook<TaxFact>(`fact:get business_owner --year 2025 --business ${importedBeta.id}`, importedId).value).toBe('spouse');
		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', importedId);
		expect(scheduleC(report).map((s) => s.businessName)).toEqual(['Alpha', 'Beta']);
		deleteTestBook(importedId);
	});

	it('deleting a business unassigns its accounts and drops its answers', () => {
		const { stdout } = runMpWithBook('business:delete Alpha', bookId);
		expect(stdout).toContain('Deleted business Alpha');
		expect(runMpWithBook('account:list --condensed', bookId).stdout).toMatch(/Consulting\n/);
		expect(runMpWithBook('account:list --condensed', bookId).stdout).not.toMatch(/Consulting\t\[/);
		expect(runMpWithBook(`fact:get business_owner --year 2025 --business ${beta.id}`, bookId).exitCode).toBe(0);

		const report = runMpJsonWithBook<ReportWithBusinesses>('tax:report --year 2025', bookId);
		expect(scheduleC(report).map((s) => s.businessName)).toEqual(['Beta', null]);
	});
});
