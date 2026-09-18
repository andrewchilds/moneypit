import { fail } from '@sveltejs/kit';
import { getTaxReturn } from '$lib/server/actions/taxReturn';
import { getTaxFact, setTaxFact } from '$lib/server/actions/taxFacts';
import { canRenderYear } from '$lib/server/taxReturn/pdf';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const { bookId } = locals;
	const yearParam = url.searchParams.get('year');
	const currentYear = new Date().getFullYear();
	const year = yearParam ? parseInt(yearParam, 10) : currentYear - 1;

	const result = await getTaxReturn(bookId, year);
	const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

	// What next year's questions already hold, keyed by question and business, so each carryover can say whether it is recorded
	const recorded: Record<string, number | null> = {};
	if (result.available) {
		for (const c of result.computation.carryovers) {
			const fact = await getTaxFact(bookId, year + 1, c.key, c.businessId);
			recorded[`${c.key}|${c.businessId ?? ''}`] = fact === null ? null : Number(fact.value);
		}
	}

	return { year, result, recorded, canRenderPdf: canRenderYear(year), availableYears };
};

export const actions: Actions = {
	/** Record a carryover as next year's answer */
	record: async ({ request, locals, url }) => {
		const data = await request.formData();
		const key = (data.get('key') as string | null)?.trim();
		const businessId = (data.get('businessId') as string | null) || null;
		const amount = Number(data.get('amount'));
		const year = parseInt(url.searchParams.get('year') ?? '', 10);
		if (!key || !Number.isFinite(amount) || !Number.isFinite(year)) return fail(400, { error: 'A carryover needs a question, an amount and a year' });
		// A carry-forward answer has no year, so recording it would change this return too
		const result = await getTaxReturn(locals.bookId, year);
		if (result.available && result.computation.carryovers.some((c) => c.key === key && c.businessId === businessId && c.carryForward)) {
			return fail(400, { error: `${key} applies to every year until changed; record it once the ${year} return is filed.` });
		}
		try {
			await setTaxFact(locals.bookId, key, amount, year + 1, businessId);
			return { success: true };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	}
};
