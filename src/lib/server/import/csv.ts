import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import type { ParsedTransaction } from './ofx';

export interface CSVFilter {
	column: string | number;
	exclude: string[]; // Values to exclude
}

export interface CSVMapping {
	dateColumn: string | number;
	dateFormat?: string; // e.g., "MM/DD/YYYY", "YYYY-MM-DD", "MM-DD-YYYY" - auto-detected if omitted
	amountColumn?: string | number;
	debitColumn?: string | number;
	creditColumn?: string | number;
	descriptionColumn: string | number;
	memoColumn?: string | number;
	skipRows?: number;
	amountSign?: 'standard' | 'inverted';
	filters?: CSVFilter[];
}

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
		// Handle datetime with space or T separator (e.g., "2025-10-27 16:08:48" or "2025-10-27T16:08:48")
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

	// Fallback to JS date parsing
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

/**
 * Detects the date format from sample date strings.
 * Analyzes multiple samples to find the most likely format.
 */
export function detectDateFormat(samples: string[]): string | null {
	const validSamples = samples.map(s => s.trim()).filter(s => s.length > 0);
	if (validSamples.length === 0) return null;

	// Try each format pattern and count matches
	const formatCounts: Record<string, number> = {};

	for (const sample of validSamples) {
		for (const { pattern, format } of DATE_FORMATS) {
			if (pattern.test(sample)) {
				formatCounts[format] = (formatCounts[format] || 0) + 1;
				break;
			}
		}
	}

	// Find format that matches all samples (or most)
	let bestFormat: string | null = null;
	let bestCount = 0;

	for (const [format, count] of Object.entries(formatCounts)) {
		if (count > bestCount) {
			bestCount = count;
			bestFormat = format;
		}
	}

	// Only return if the format matches most samples
	if (bestFormat && bestCount >= validSamples.length * 0.8) {
		return bestFormat;
	}

	return null;
}

function parseAmount(value: string): number {
	if (!value || value.trim() === '') return 0;
	// Remove currency symbols, commas, and whitespace
	const cleaned = value.replace(/[$,\s]/g, '').trim();
	// Handle parentheses as negative (accounting format)
	if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
		return -parseFloat(cleaned.slice(1, -1));
	}
	return parseFloat(cleaned);
}

function getValue(row: Record<string, string>, column: string | number): string {
	if (typeof column === 'number') {
		const keys = Object.keys(row);
		return row[keys[column]] || '';
	}
	return row[column] || '';
}

export async function parseCSV(filePath: string, mapping: CSVMapping): Promise<ParsedTransaction[]> {
	const content = await readFile(filePath, 'utf-8');

	const records = parse(content, {
		columns: true,
		skip_empty_lines: true,
		from_line: (mapping.skipRows || 0) + 1,
		relax_column_count: true,
		trim: true
	}) as Record<string, string>[];

	// Auto-detect date format if not provided
	let dateFormat: string | undefined = mapping.dateFormat;
	if (!dateFormat) {
		const dateSamples = records.slice(0, 10).map(row => getValue(row, mapping.dateColumn));
		const detected = detectDateFormat(dateSamples);
		if (!detected) {
			throw new Error(`Could not auto-detect date format. Sample dates: ${dateSamples.slice(0, 3).join(', ')}. Please specify dateFormat in mapping.`);
		}
		dateFormat = detected;
	}

	const transactions: ParsedTransaction[] = [];

	for (const row of records) {
		// Apply filters
		if (mapping.filters && mapping.filters.length > 0) {
			let excluded = false;
			for (const filter of mapping.filters) {
				const value = getValue(row, filter.column).trim();
				if (filter.exclude.some((ex) => ex.toLowerCase() === value.toLowerCase())) {
					excluded = true;
					break;
				}
			}
			if (excluded) continue;
		}

		const dateStr = getValue(row, mapping.dateColumn);
		if (!dateStr) continue;

		let amount: number;

		if (mapping.amountColumn !== undefined) {
			amount = parseAmount(getValue(row, mapping.amountColumn));
		} else if (mapping.debitColumn !== undefined || mapping.creditColumn !== undefined) {
			const debit = mapping.debitColumn !== undefined ? parseAmount(getValue(row, mapping.debitColumn)) : 0;
			const credit = mapping.creditColumn !== undefined ? parseAmount(getValue(row, mapping.creditColumn)) : 0;
			amount = debit - credit;
		} else {
			throw new Error('CSV mapping must specify amountColumn or debitColumn/creditColumn');
		}

		if (mapping.amountSign === 'inverted') {
			amount = -amount;
		}

		if (amount === 0) continue;

		const description = getValue(row, mapping.descriptionColumn);
		const memo = mapping.memoColumn ? getValue(row, mapping.memoColumn) : undefined;

		transactions.push({
			date: parseDate(dateStr, dateFormat),
			amount,
			description,
			memo: memo || undefined
		});
	}

	return transactions;
}

export async function previewCSV(
	filePath: string,
	limit: number = 10
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
	const content = await readFile(filePath, 'utf-8');

	const records = parse(content, {
		columns: true,
		skip_empty_lines: true,
		relax_column_count: true,
		trim: true,
		to_line: limit + 1
	}) as Record<string, string>[];

	const headers = records.length > 0 ? Object.keys(records[0]) : [];

	return { headers, rows: records.slice(0, limit) };
}

