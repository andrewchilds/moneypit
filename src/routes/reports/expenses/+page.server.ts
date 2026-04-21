import { getExpensesReportData } from "$lib/server/actions";
import type { PageServerLoad } from "./$types";

export type DateRangePreset = "ytd" | "last-6-months" | "last-12-months" | "last-18-months" | "custom";

function getDateRange(preset: DateRangePreset, year?: number): { from: Date; to: Date; label: string } {
	const now = new Date();
	const currentYear = now.getFullYear();

	switch (preset) {
		case "ytd":
			return {
				from: new Date(currentYear, 0, 1),
				to: now,
				label: `${currentYear} YTD`
			};
		case "last-6-months": {
			const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
			return {
				from: sixMonthsAgo,
				to: now,
				label: "Last 6 Months"
			};
		}
		case "last-12-months": {
			const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
			return {
				from: twelveMonthsAgo,
				to: now,
				label: "Last 12 Months"
			};
		}
		case "last-18-months": {
			const eighteenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 18, 1);
			return {
				from: eighteenMonthsAgo,
				to: now,
				label: "Last 18 Months"
			};
		}
		case "custom":
			if (year) {
				return {
					from: new Date(year, 0, 1),
					to: new Date(year, 11, 31, 23, 59, 59, 999),
					label: String(year)
				};
			}
			// Fallback to YTD
			return {
				from: new Date(currentYear, 0, 1),
				to: now,
				label: `${currentYear} YTD`
			};
		default:
			return {
				from: new Date(currentYear, 0, 1),
				to: now,
				label: `${currentYear} YTD`
			};
	}
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const { bookId } = locals;
	const presetParam = url.searchParams.get("range") as DateRangePreset | null;
	const yearParam = url.searchParams.get("year");

	const preset = presetParam || "ytd";
	const year = yearParam ? parseInt(yearParam, 10) : undefined;

	const { from, to, label } = getDateRange(preset, year);
	const expensesData = await getExpensesReportData(bookId, from, to);

	// Get available years for the custom selector (current year back to 5 years ago)
	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

	return {
		expensesData: {
			...expensesData,
			dateRange: {
				from: expensesData.dateRange.from.toISOString(),
				to: expensesData.dateRange.to.toISOString()
			}
		},
		currentPreset: preset,
		rangeLabel: label,
		availableYears
	};
};
