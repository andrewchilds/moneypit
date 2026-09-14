import type { FactValue } from './types';

/** The account ids in an `accounts` answer */
export function asAccountIds(value: FactValue | undefined): string[] {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
	return [];
}
