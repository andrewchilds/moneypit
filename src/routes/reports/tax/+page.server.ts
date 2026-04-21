import { getTaxReportData } from '$lib/server/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const { bookId } = locals;
	const yearParam = url.searchParams.get('year');
	const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

	const taxData = await getTaxReportData(bookId, year);

	// Get available years (current year and previous 5 years)
	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

	return {
		taxData,
		availableYears
	};
};
