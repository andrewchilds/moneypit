import { describe, it, expect } from 'bun:test';
import { parseDate, detectDateFormat, parseAmount } from '$lib/server/import/csv';

describe('parseDate', () => {
	it('parses MM/DD/YYYY format', () => {
		const date = parseDate('03/15/2026', 'MM/DD/YYYY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2); // March = 2
		expect(date.getDate()).toBe(15);
	});

	it('parses YYYY-MM-DD format', () => {
		const date = parseDate('2026-03-15', 'YYYY-MM-DD');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(15);
	});

	it('parses MM-DD-YYYY format', () => {
		const date = parseDate('03-15-2026', 'MM-DD-YYYY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2); // March = 2
		expect(date.getDate()).toBe(15);
	});

	it('parses YYYY-MM-DD with space time separator', () => {
		const date = parseDate('2025-10-27 16:08:48', 'YYYY-MM-DD');
		expect(date.getFullYear()).toBe(2025);
		expect(date.getMonth()).toBe(9); // October = 9
		expect(date.getDate()).toBe(27);
	});

	it('parses YYYY-MM-DD with T time separator', () => {
		const date = parseDate('2025-10-27T16:08:48', 'YYYY-MM-DD');
		expect(date.getFullYear()).toBe(2025);
		expect(date.getMonth()).toBe(9); // October = 9
		expect(date.getDate()).toBe(27);
	});

	it('parses M/D/YYYY with single digit month/day', () => {
		const date = parseDate('3/5/2026', 'M/D/YYYY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(5);
	});

	it('parses M/D/YY with 2-digit year', () => {
		const date = parseDate('3/5/26', 'M/D/YY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(5);
	});

	it('parses DD/MM/YYYY (European format)', () => {
		const date = parseDate('15/03/2026', 'DD/MM/YYYY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(15);
	});

	it('handles whitespace', () => {
		const date = parseDate('  03/15/2026  ', 'MM/DD/YYYY');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(15);
	});
});

describe('parseAmount', () => {
	it('parses simple number', () => {
		expect(parseAmount('123.45')).toBe(123.45);
	});

	it('parses with dollar sign', () => {
		expect(parseAmount('$123.45')).toBe(123.45);
	});

	it('parses with commas', () => {
		expect(parseAmount('1,234.56')).toBe(1234.56);
	});

	it('parses with dollar sign and commas', () => {
		expect(parseAmount('$1,234.56')).toBe(1234.56);
	});

	it('parses accounting format (negative in parentheses)', () => {
		expect(parseAmount('(123.45)')).toBe(-123.45);
	});

	it('parses accounting format with dollar sign', () => {
		expect(parseAmount('($1,234.56)')).toBe(-1234.56);
	});

	it('returns 0 for empty string', () => {
		expect(parseAmount('')).toBe(0);
	});

	it('returns 0 for whitespace only', () => {
		expect(parseAmount('   ')).toBe(0);
	});

	it('handles whitespace around value', () => {
		expect(parseAmount('  $123.45  ')).toBe(123.45);
	});

	it('parses negative numbers', () => {
		expect(parseAmount('-123.45')).toBe(-123.45);
	});

	it('parses large numbers', () => {
		expect(parseAmount('$999,999,999.99')).toBe(999999999.99);
	});
});

describe('detectDateFormat', () => {
	it('detects MM/DD/YYYY format', () => {
		const samples = ['03/15/2026', '04/20/2026', '12/31/2025'];
		expect(detectDateFormat(samples)).toBe('MM/DD/YYYY');
	});

	it('detects MM-DD-YYYY format', () => {
		const samples = ['03-15-2026', '04-20-2026', '12-31-2025'];
		expect(detectDateFormat(samples)).toBe('MM-DD-YYYY');
	});

	it('detects YYYY-MM-DD format', () => {
		const samples = ['2026-03-15', '2026-04-20', '2025-12-31'];
		expect(detectDateFormat(samples)).toBe('YYYY-MM-DD');
	});

	it('detects YYYY-MM-DD with space time separator', () => {
		const samples = ['2026-03-15 10:30:00', '2026-04-20 14:00:00'];
		expect(detectDateFormat(samples)).toBe('YYYY-MM-DD');
	});

	it('detects YYYY-MM-DD with T time separator (ISO 8601)', () => {
		const samples = ['2026-03-15T10:30:00', '2026-04-20T14:00:00Z'];
		expect(detectDateFormat(samples)).toBe('YYYY-MM-DD');
	});

	it('detects M/D/YYYY format with single digits', () => {
		const samples = ['3/5/2026', '4/20/2026', '12/1/2025'];
		expect(detectDateFormat(samples)).toBe('M/D/YYYY');
	});

	it('detects M/D/YY format', () => {
		const samples = ['3/5/26', '4/20/26', '12/1/25'];
		expect(detectDateFormat(samples)).toBe('M/D/YY');
	});

	it('returns null for empty samples', () => {
		expect(detectDateFormat([])).toBe(null);
	});

	it('returns null for unrecognized formats', () => {
		const samples = ['March 15, 2026', 'April 20, 2026'];
		expect(detectDateFormat(samples)).toBe(null);
	});

	it('handles whitespace in samples', () => {
		const samples = ['  03/15/2026  ', '04/20/2026', '  12/31/2025'];
		expect(detectDateFormat(samples)).toBe('MM/DD/YYYY');
	});

	it('tolerates some mismatches if majority matches', () => {
		const samples = ['03/15/2026', '04/20/2026', '12/31/2025', '2026-01-01', '05/05/2026'];
		expect(detectDateFormat(samples)).toBe('MM/DD/YYYY');
	});
});
