import { describe, it, expect } from 'bun:test';
import { parseCapitalGainBox, rowsFromDocument, SCHEDULE_D_LINE, isShortTermBox } from '$lib/server/taxReturn/form8949';

describe('parseCapitalGainBox', () => {
	it('reads the box letter, the column and an adjustment code', () => {
		expect(parseCapitalGainBox('A')).toEqual({ box: 'A', kind: 'gain' });
		expect(parseCapitalGainBox('b.proceeds')).toEqual({ box: 'B', kind: 'proceeds' });
		expect(parseCapitalGainBox(' D.basis ')).toEqual({ box: 'D', kind: 'basis' });
		expect(parseCapitalGainBox('A.adj.W')).toEqual({ box: 'A', kind: 'adj', code: 'W' });
		expect(parseCapitalGainBox('e.adj.bw')).toEqual({ box: 'E', kind: 'adj', code: 'BW' });
	});

	it('ignores boxes that are not Form 8949 boxes', () => {
		for (const box of ['4', 'ST', 'LT', 'M', 'A.gain', 'A.adj', '1d']) expect(parseCapitalGainBox(box)).toBeNull();
	});

	it('sends each box to its Schedule D line', () => {
		expect(SCHEDULE_D_LINE.A).toBe('1b');
		expect(SCHEDULE_D_LINE.B).toBe('2');
		expect(SCHEDULE_D_LINE.D).toBe('8b');
		expect(SCHEDULE_D_LINE.E).toBe('9');
		expect(SCHEDULE_D_LINE.G).toBe('1b');
		expect(isShortTermBox('C')).toBe(true);
		expect(isShortTermBox('J')).toBe(false);
	});
});

describe('rowsFromDocument', () => {
	const line = (id: string, box: string, amount: number, taxCategoryId: string | null = null) => ({ id, box, amount, taxCategoryId });

	it('makes one row per box with proceeds or basis, keeping the net line and its category', () => {
		const { rows, consumed } = rowsFromDocument('Betterment', [
			line('g', 'A', -66.28, 'st'),
			line('p', 'A.proceeds', 1200),
			line('b', 'A.basis', 1269.63),
			line('w', 'A.adj.W', 3.35),
			line('lg', 'D', 7912.58, 'lt'),
			line('lp', 'D.proceeds', 30000),
			line('lb', 'D.basis', 22087.42),
			line('x', '4', 0)
		]);
		expect(rows.map((r) => r.row.box)).toEqual(['A', 'D']);
		expect(rows[0].row).toEqual({
			box: 'A',
			description: 'Betterment - various',
			dateAcquired: 'Various',
			dateSold: 'Various',
			proceeds: 1200,
			basis: 1269.63,
			adjustments: [{ code: 'W', amount: 3.35 }],
			reported: -66.28
		});
		expect(rows[0].gainLine?.taxCategoryId).toBe('st');
		expect(rows[1].row.adjustments).toEqual([]);
		expect(rows[1].row.reported).toBe(7912.58);
		expect(consumed.sort()).toEqual(['b', 'g', 'lb', 'lg', 'lp', 'p', 'w']);
	});

	it('leaves a box with only a net figure alone, so it stays a net figure on Schedule D', () => {
		const { rows, consumed } = rowsFromDocument('Ally', [line('g', 'B', -17681, 'st'), line('w', '4', 0)]);
		expect(rows).toEqual([]);
		expect(consumed).toEqual([]);
	});

	it('makes a row without a net line and reports nothing to check against', () => {
		const { rows } = rowsFromDocument('Ally', [line('p', 'b.proceeds', 180000), line('b', 'B.basis', 197681)]);
		expect(rows[0].row.reported).toBeNull();
		expect(rows[0].gainLine).toBeNull();
	});
});
