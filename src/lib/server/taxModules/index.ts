export type { TaxModule, TaxModuleCategory } from './types';
export { taxModules } from './modules';

import { taxModules } from './modules';
import type { TaxModule } from './types';

export function getModule(moduleId: string): TaxModule | undefined {
	return taxModules.find((m) => m.id === moduleId);
}

export function getAllModules(): TaxModule[] {
	return taxModules;
}

export function getModulesByGroup(group: TaxModule['group']): TaxModule[] {
	return taxModules.filter((m) => m.group === group);
}
