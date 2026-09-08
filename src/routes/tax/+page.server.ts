import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Tax prep is almost always for the most recently completed year
export const load: PageServerLoad = async () => {
	throw redirect(302, `/tax/${new Date().getFullYear() - 1}`);
};
