export type {
	TaxModule,
	TaxModuleCategory,
	TaxQuestion,
	TaxQuestionType,
	FactValue,
	FactExpectedDocument
} from './types';
export { taxModules } from './modules';

import { taxModules } from './modules';
import type { TaxModule, TaxQuestion } from './types';

export function getModule(moduleId: string): TaxModule | undefined {
	return taxModules.find((m) => m.id === moduleId);
}

export function getAllModules(): TaxModule[] {
	return taxModules;
}

export function getModulesByGroup(group: TaxModule['group']): TaxModule[] {
	return taxModules.filter((m) => m.group === group);
}

/** Find a question by key across all modules, enabled or not. */
export function findQuestion(key: string): { module: TaxModule; question: TaxQuestion } | undefined {
	for (const module of taxModules) {
		const question = module.questions?.find((q) => q.key === key);
		if (question) return { module, question };
	}
	return undefined;
}
