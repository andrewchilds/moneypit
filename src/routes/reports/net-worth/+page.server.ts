import { getNetWorthOverTime } from '$lib/server/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { bookId } = locals;
	const netWorthData = await getNetWorthOverTime(bookId);

	return {
		netWorthData
	};
};
