import { describe, it, expect } from 'bun:test';
import { parseLocalDate } from '$lib/utils/date';

describe('parseLocalDate', () => {
	it('parses YYYY-MM-DD as local date', () => {
		const date = parseLocalDate('2026-04-14');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(3); // April = 3
		expect(date.getDate()).toBe(14);
	});

	it('does not shift date due to timezone', () => {
		// This is the key bug that parseLocalDate fixes
		// new Date('2026-04-14') parses as UTC midnight, which in US timezones
		// displays as April 13. parseLocalDate avoids this.
		const date = parseLocalDate('2026-04-14');

		// Should be April 14 regardless of timezone
		expect(date.getDate()).toBe(14);
	});

	it('handles single digit months and days', () => {
		const date = parseLocalDate('2026-01-05');
		expect(date.getMonth()).toBe(0); // January = 0
		expect(date.getDate()).toBe(5);
	});

	it('handles end of year', () => {
		const date = parseLocalDate('2026-12-31');
		expect(date.getMonth()).toBe(11); // December = 11
		expect(date.getDate()).toBe(31);
	});

	it('handles leap year', () => {
		const date = parseLocalDate('2024-02-29');
		expect(date.getMonth()).toBe(1); // February = 1
		expect(date.getDate()).toBe(29);
	});
});
