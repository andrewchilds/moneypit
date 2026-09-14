import type { AccountShare, FactValue } from './types';

/** The account ids in an `accounts` or `account_shares` answer */
export function asAccountIds(value: FactValue | undefined): string[] {
	if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : v.id));
	if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
	return [];
}

/** The entries of an `account_shares` answer, dropping anything malformed */
export function asAccountShares(value: FactValue | undefined): AccountShare[] {
	if (!Array.isArray(value)) return [];
	const shares: AccountShare[] = [];
	for (const v of value) {
		if (typeof v !== 'object' || v === null || typeof v.id !== 'string') continue;
		const percent = Number(v.percent);
		if (!Number.isFinite(percent)) continue;
		shares.push({ id: v.id, percent });
	}
	return shares;
}
