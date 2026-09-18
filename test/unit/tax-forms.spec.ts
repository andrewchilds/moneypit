import { describe, it, expect } from 'bun:test';
import { FORM_PRESETS, getBoxPreset } from '$lib/taxForms';

describe('form presets', () => {
	it('knows the Schedule K-1 boxes the return routes', () => {
		const boxes = FORM_PRESETS['K-1'].boxes.map((b) => b.box);
		expect(boxes).toEqual(['1', '2', '3', '5', '6a', '6b', '8', '9a', '11C', '13AE', '20A', '20B']);
		expect(getBoxPreset('k1', '11c')?.categoryHints).toEqual(['^section 1256']);
		expect(getBoxPreset('K-1', '13AE')?.categoryHints).toBeUndefined();
	});

	it('guesses the partnership capital gain categories only for the K-1, not the 1099-B', () => {
		const partnership = 'Partnership Capital Gains - Short Term';
		const own = 'Capital Gains - Short Term';
		const matches = (hints: string[] | undefined, name: string) => (hints ?? []).some((h) => new RegExp(h, 'i').test(name));
		expect(matches(getBoxPreset('1099-B', 'A')?.categoryHints, partnership)).toBe(false);
		expect(matches(getBoxPreset('1099-B', 'A')?.categoryHints, own)).toBe(true);
		expect(matches(getBoxPreset('K-1', '8')?.categoryHints, partnership)).toBe(true);
		expect(matches(getBoxPreset('K-1', '8')?.categoryHints, own)).toBe(false);
	});
});
