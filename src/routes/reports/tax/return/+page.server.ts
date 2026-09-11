import { getTaxReturn } from '$lib/server/actions/taxReturn';
import { canRenderYear } from '$lib/server/taxReturn/pdf';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const { bookId } = locals;
	const yearParam = url.searchParams.get('year');
	const currentYear = new Date().getFullYear();
	const year = yearParam ? parseInt(yearParam, 10) : currentYear - 1;

	const result = await getTaxReturn(bookId, year);
	const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

	return { year, result, canRenderPdf: canRenderYear(year), availableYears };
};
