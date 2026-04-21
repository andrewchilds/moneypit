import { describe, it, expect } from 'bun:test';

// These functions are currently internal to csv.ts - we'll test them via parseCSV
// For now, test the date parsing logic directly by reimplementing the pure functions

// Extracted from src/lib/server/import/csv.ts for unit testing
function parseDate(dateStr: string, format: string): Date {
	const str = dateStr.trim();

	if (format === 'MM/DD/YYYY') {
		const [month, day, year] = str.split('/').map(Number);
		return new Date(year, month - 1, day);
	}

	if (format === 'MM-DD-YYYY') {
		const [month, day, year] = str.split('-').map(Number);
		return new Date(year, month - 1, day);
	}

	if (format === 'YYYY-MM-DD') {
		// Handle datetime with space or T separator
		const datePart = str.split(/[ T]/)[0];
		const [year, month, day] = datePart.split('-').map(Number);
		return new Date(year, month - 1, day);
	}

	if (format === 'M/D/YYYY' || format === 'M/D/YY') {
		const parts = str.split('/');
		const month = parseInt(parts[0], 10);
		const day = parseInt(parts[1], 10);
		let year = parseInt(parts[2], 10);
		if (year < 100) year += 2000;
		return new Date(year, month - 1, day);
	}

	if (format === 'DD/MM/YYYY') {
		const [day, month, year] = str.split('/').map(Number);
		return new Date(year, month - 1, day);
	}

	return new Date(str);
}

// Supported date formats for auto-detection
const DATE_FORMATS = [
	{ pattern: /^\d{4}-\d{2}-\d{2}/, format: 'YYYY-MM-DD' },
	{ pattern: /^\d{2}-\d{2}-\d{4}$/, format: 'MM-DD-YYYY' },
	{ pattern: /^\d{2}\/\d{2}\/\d{4}$/, format: 'MM/DD/YYYY' },
	{ pattern: /^\d{1,2}\/\d{1,2}\/\d{4}$/, format: 'M/D/YYYY' },
	{ pattern: /^\d{1,2}\/\d{1,2}\/\d{2}$/, format: 'M/D/YY' }
];

function detectDateFormat(samples: string[]): string | null {
	const validSamples = samples.map(s => s.trim()).filter(s => s.length > 0);
	if (validSamples.length === 0) return null;

	const formatCounts: Record<string, number> = {};

	for (const sample of validSamples) {
		for (const { pattern, format } of DATE_FORMATS) {
			if (pattern.test(sample)) {
				formatCounts[format] = (formatCounts[format] || 0) + 1;
				break;
			}
		}
	}

	let bestFormat: string | null = null;
	let bestCount = 0;

	for (const [format, count] of Object.entries(formatCounts)) {
		if (count > bestCount) {
			bestCount = count;
			bestFormat = format;
		}
	}

	if (bestFormat && bestCount >= validSamples.length * 0.8) {
		return bestFormat;
	}

	return null;
}

function parseAmount(value: string): number {
	if (!value || value.trim() === '') return 0;
	const cleaned = value.replace(/[$,\s]/g, '').trim();
	if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
		return -parseFloat(cleaned.slice(1, -1));
	}
	return parseFloat(cleaned);
}

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
