export type {
	TaxModule,
	TaxModuleCategory,
	TaxQuestion,
	TaxQuestionType,
	FactValue,
	AccountShare,
	FactExpectedDocument,
	TaxWorksheet,
	WorksheetInput,
	WorksheetAccountFigure,
	WorksheetLine,
	WorksheetBreakdownRow,
	WorksheetResult
} from './types';
export { taxModules } from './modules';
export { asAccountIds, asAccountShares } from './values';

import { taxModules } from './modules';
import type { TaxModule, TaxQuestion, TaxWorksheet } from './types';

export function getModule(moduleId: string): TaxModule | undefined {
	return taxModules.find((m) => m.id === moduleId);
}

export function getAllModules(): TaxModule[] {
	return taxModules;
}

export function getModulesByGroup(group: TaxModule['group']): TaxModule[] {
	return taxModules.filter((m) => m.group === group);
}

/** Extract the schedule a category belongs to: "Schedule C Line 8" -> "Schedule C". */
export function scheduleOf(scheduleRef: string | null): string | null {
	if (!scheduleRef) return null;
	// "Schedule C", "Schedule 1", "Form 1120", "IT-201", "NJ-1040", "CA 540", "Schedule CA"
	const match = scheduleRef.match(/^(Schedule (?:[A-Z]{1,2}|\d+)|Form \d+|[A-Z]{2}-?\d+|CA \d+)/);
	return match ? match[1] : scheduleRef.split(' ')[0];
}

/** Schedules whose report sections are split per business (from perBusiness modules). */
export function perBusinessSchedules(): Set<string> {
	const schedules = new Set<string>();
	for (const module of taxModules) {
		if (!module.perBusiness) continue;
		for (const cat of module.categories) {
			const schedule = scheduleOf(cat.scheduleRef);
			if (schedule) schedules.add(schedule);
		}
	}
	return schedules;
}

/** Find a worksheet by id across all modules, enabled or not. */
export function findWorksheet(worksheetId: string): { module: TaxModule; worksheet: TaxWorksheet } | undefined {
	for (const module of taxModules) {
		const worksheet = module.worksheets?.find((w) => w.id === worksheetId);
		if (worksheet) return { module, worksheet };
	}
	return undefined;
}

/** Find a question by key across all modules, enabled or not. */
export function findQuestion(key: string): { module: TaxModule; question: TaxQuestion } | undefined {
	for (const module of taxModules) {
		const question = module.questions?.find((q) => q.key === key);
		if (question) return { module, question };
	}
	return undefined;
}
