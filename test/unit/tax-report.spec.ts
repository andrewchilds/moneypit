import { describe, it, expect } from 'bun:test';
import { taxTransactionRows } from '$lib/server/actions/reports';

interface Side {
	id: string;
	path: string;
	assetType: string | null;
}

const checking: Side = { id: 'chk', path: 'Ally:Checking', assetType: 'LIQUID' };
const roth: Side = { id: 'roth', path: 'Vanguard:Roth IRA', assetType: 'ROTH_RETIREMENT' };
const ira: Side = { id: 'ira', path: 'Vanguard:Traditional IRA', assetType: 'TAX_DEFERRED' };
const dividends: Side = { id: 'div', path: 'Dividends', assetType: null };
const hosting: Side = { id: 'host', path: 'Business:Hosting', assetType: null };

let seq = 0;
function tx(
	debit: Side | null,
	credit: Side | null,
	amount: number,
	extra: { mergedIntoId?: string | null; description?: string } = {}
) {
	seq += 1;
	return {
		id: `tx${seq}`,
		date: new Date(2025, 0, seq),
		description: extra.description ?? `Transaction ${seq}`,
		amount,
		status: debit && credit ? 'CATEGORIZED' : 'PENDING',
		mergedIntoId: extra.mergedIntoId ?? null,
		debitAccount: debit,
		creditAccount: credit
	};
}

describe('taxTransactionRows', () => {
	it('lists income credited from a liquid account and sums to the total', () => {
		const result = taxTransactionRows('div', 'INCOME', [tx(checking, dividends, 100), tx(checking, dividends, 25.5)]);
		expect(result.rows.map((r) => r.amount)).toEqual([100, 25.5]);
		expect(result.total).toBe(125.5);
		expect(result.excluded).toEqual({ count: 0, amount: 0 });
		expect(result.rows[0].otherAccount).toEqual({ id: 'chk', path: 'Ally:Checking' });
	});

	it('excludes transactions whose other side is a Roth or tax-deferred account', () => {
		const result = taxTransactionRows('div', 'INCOME', [
			tx(checking, dividends, 100),
			tx(roth, dividends, 40),
			tx(ira, dividends, 60)
		]);
		expect(result.rows.map((r) => r.id)).toEqual(['tx3']);
		expect(result.total).toBe(100);
		expect(result.excluded).toEqual({ count: 2, amount: 100 });
	});

	it('counts a refund on an expense account as negative so it reduces the total', () => {
		const result = taxTransactionRows('host', 'EXPENSE', [
			tx(hosting, checking, 120, { description: 'DigitalOcean' }),
			tx(checking, hosting, 20, { description: 'DigitalOcean credit' })
		]);
		expect(result.rows.map((r) => r.amount)).toEqual([120, -20]);
		expect(result.total).toBe(100);
	});

	it('skips transactions that were merged into another', () => {
		const result = taxTransactionRows('host', 'EXPENSE', [
			tx(hosting, checking, 50),
			tx(hosting, checking, 50, { mergedIntoId: 'tx7' })
		]);
		expect(result.rows.length).toBe(1);
		expect(result.total).toBe(50);
	});

	it('includes a pending transaction with only this side categorized', () => {
		const result = taxTransactionRows('host', 'EXPENSE', [tx(hosting, null, 30)]);
		expect(result.rows[0].otherAccount).toBeNull();
		expect(result.total).toBe(30);
	});

	it('ignores transactions that do not touch the account', () => {
		const result = taxTransactionRows('host', 'EXPENSE', [tx(checking, dividends, 30)]);
		expect(result.rows.length).toBe(0);
		expect(result.total).toBe(0);
	});
});
