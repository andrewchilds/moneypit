export interface TaxModuleCategory {
	name: string;
	scheduleRef: string;
	description?: string;
}

/** `accounts` stores a list of account ids, picked from the book's EXPENSE accounts. */
export type TaxQuestionType = 'boolean' | 'choice' | 'amount' | 'number' | 'date' | 'text' | 'accounts';

export type FactValue = string | number | boolean | string[];

/**
 * A question a module needs answered for a tax year. Answers are stored as
 * TaxFacts keyed by `key`. Questions with `carryForward` are stored without a
 * year and apply to every year until changed.
 */
export interface TaxQuestion {
	key: string;
	prompt: string;
	type: TaxQuestionType;
	description?: string;
	options?: { value: string; label: string }[];
	carryForward?: boolean;
	/** Only ask when another fact has this value, or (with `min`) a number at least this large */
	dependsOn?: { key: string; value: FactValue } | { key: string; min: number };
}

/** A document the module expects to be on hand when a fact has a given value */
export interface FactExpectedDocument {
	formType: string;
	whenFact: { key: string; value: FactValue };
	reason: string;
}

/** An account's year total from the books, as the tax report counts it */
export interface WorksheetAccountFigure {
	id: string;
	path: string;
	type: 'INCOME' | 'EXPENSE';
	total: number;
}

/** An account attached to the business the worksheet runs for, and the fraction of it (0 to 1) the business claims */
export interface WorksheetAccountShare {
	id: string;
	share: number;
}

export interface WorksheetInput {
	/** Answers to the facts the worksheet declares, for the business it runs for */
	facts: Partial<Record<string, FactValue>>;
	/** Every income and expense account in the book with its year total */
	accounts: WorksheetAccountFigure[];
	/**
	 * Accounts attached to the business whose own tax category is not on
	 * the business's schedule (a personal phone account), so nothing has
	 * put them on the section yet. Empty when the worksheet runs for no
	 * business in particular.
	 */
	shares: WorksheetAccountShare[];
	/**
	 * Figures for the schedule section the worksheet feeds, before its own
	 * output: what is reported as income and as other expenses.
	 */
	section: { income: number; expenses: number };
}

/** A figure the worksheet produces, keyed by the tax category it lands on */
export interface WorksheetLine {
	category: string;
	amount: number;
}

/** One step of the computation, for display */
export interface WorksheetBreakdownRow {
	label: string;
	detail?: string;
	amount: number | null;
	/** What the row is, so the display can style inputs, results, and carryovers */
	kind: 'input' | 'allocation' | 'subtotal' | 'limit' | 'result' | 'carryover';
	/**
	 * On an allocation row, the account allocated and the fraction of its
	 * total claimed (0 to 1), so the report can notice an account claimed by
	 * two worksheets or more than once over across businesses. Leave `share`
	 * off when the allocation is the business's own attachment to the
	 * account, which the report already counts as a claim.
	 */
	accountId?: string;
	share?: number;
	/** On an allocation row, the account's whole year total the share is taken of */
	base?: number;
}

export interface WorksheetResult {
	lines: WorksheetLine[];
	breakdown: WorksheetBreakdownRow[];
}

/**
 * A computation over facts and book figures that produces figures for the
 * tax report (a Schedule C line 30 from home office square footage, say).
 * Worksheets on a perBusiness module run once per business.
 */
export interface TaxWorksheet {
	id: string;
	name: string;
	description?: string;
	/** Fact keys the worksheet reads */
	facts: string[];
	/** Null when the worksheet has nothing to contribute (facts missing or not applicable) */
	compute(input: WorksheetInput): WorksheetResult | null;
}

export interface TaxModule {
	id: string;
	name: string;
	description: string;
	group: 'us-federal' | 'us-state' | 'corporate';
	categories: TaxModuleCategory[];
	questions?: TaxQuestion[];
	expectedDocuments?: FactExpectedDocument[];
	worksheets?: TaxWorksheet[];
	/**
	 * Ask this module's questions once per business in the book, and split
	 * its categories in the tax report by the business each account belongs
	 * to. A book with no businesses behaves as if it had exactly one.
	 */
	perBusiness?: boolean;
}
