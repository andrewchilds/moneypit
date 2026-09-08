export interface TaxModuleCategory {
	name: string;
	scheduleRef: string;
	description?: string;
}

export type TaxQuestionType = 'boolean' | 'choice' | 'amount' | 'number' | 'date' | 'text';

export type FactValue = string | number | boolean;

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
	/** Only ask when another fact has this value */
	dependsOn?: { key: string; value: FactValue };
}

/** A document the module expects to be on hand when a fact has a given value */
export interface FactExpectedDocument {
	formType: string;
	whenFact: { key: string; value: FactValue };
	reason: string;
}

export interface TaxModule {
	id: string;
	name: string;
	description: string;
	group: 'us-federal' | 'us-state' | 'corporate';
	categories: TaxModuleCategory[];
	questions?: TaxQuestion[];
	expectedDocuments?: FactExpectedDocument[];
}
