export interface TaxModuleCategory {
	name: string;
	scheduleRef: string;
	description?: string;
}

/**
 * `accounts` stores a list of account ids, picked from the book's EXPENSE
 * accounts; `account_shares` stores a percentage per account (the business
 * share of a phone bill, say) as `AccountShare[]`.
 */
export type TaxQuestionType = 'boolean' | 'choice' | 'amount' | 'number' | 'date' | 'text' | 'accounts' | 'account_shares';

/** One entry of an `account_shares` answer: an account and the percentage of it claimed */
export interface AccountShare {
	id: string;
	percent: number;
}

export type FactValue = string | number | boolean | string[] | AccountShare[];

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

export interface WorksheetInput {
	/** Answers to the facts the worksheet declares, for the business it runs for */
	facts: Partial<Record<string, FactValue>>;
	/** Every income and expense account in the book with its year total */
	accounts: WorksheetAccountFigure[];
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
	 * two worksheets or more than once over across businesses.
	 */
	accountId?: string;
	share?: number;
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
