/**
 * Parse a YYYY-MM-DD string as a local date.
 *
 * IMPORTANT: Do NOT use `new Date("YYYY-MM-DD")` for date-only strings from form inputs.
 * That parses as UTC midnight, which displays as the previous day in US timezones.
 *
 * @example
 * // Wrong - parses as UTC, shows as Apr 13 in EST
 * new Date("2026-04-14")
 *
 * // Correct - parses as local midnight
 * parseLocalDate("2026-04-14")
 */
export function parseLocalDate(dateStr: string): Date {
	const [year, month, day] = dateStr.split('-').map(Number);
	return new Date(year, month - 1, day);
}

/**
 * Format a Date as YYYY-MM-DD using local timezone.
 *
 * IMPORTANT: Do NOT use `date.toISOString().split('T')[0]` as that converts to UTC first,
 * which can shift the date in US timezones.
 */
export function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
