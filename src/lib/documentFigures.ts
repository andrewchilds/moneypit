/**
 * Reading figures off a tax form's text. Pure functions so they can be unit
 * tested without a PDF renderer; the viewer feeds them text items from pdf.js.
 */

import { FORM_TYPES } from './taxForms';

const MONEY = /\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\)?/g;

/**
 * The last money-like number in a run of text, or null. "Box 1 Interest
 * income $412.34" -> 412.34; "(1,200.00)" -> -1200.
 */
export function parseFigure(text: string): number | null {
	const matches = [...text.matchAll(MONEY)];
	if (matches.length === 0) return null;
	const parse = (raw: string) => {
		const negative = raw.includes('(') || raw.includes('-');
		const digits = raw.replace(/[^\d.]/g, '');
		if (!/\d/.test(digits)) return null;
		const value = parseFloat(digits);
		return Number.isNaN(value) ? null : negative ? -value : value;
	};
	// Prefer something that reads as money: cents, thousands separators, or a dollar sign
	for (let i = matches.length - 1; i >= 0; i--) {
		const raw = matches[i][0];
		if (/[$,.]/.test(raw)) {
			const value = parse(raw);
			if (value !== null) return value;
		}
	}
	for (let i = matches.length - 1; i >= 0; i--) {
		const m = matches[i];
		// A bare number at the start of a label ("9 Specified private...") is the box number, not a figure
		if (m.index === 0 && /^\d+\s+[A-Za-z]/.test(text.trim())) continue;
		const value = parse(m[0]);
		if (value !== null) return value;
	}
	return null;
}

/** Whether a text item is a figure on its own (an amount, not a label with digits). */
export function looksLikeFigure(text: string): boolean {
	const t = text.trim();
	if (!/\d/.test(t)) return false;
	return /^\(?-?\$?\s?\d{1,3}(,\d{3})*(\.\d{1,2})?\)?$/.test(t) || /^\(?-?\$?\s?\d+(\.\d{1,2})?\)?$/.test(t);
}

/** Format a stored amount for an input field: two decimals, no grouping. */
export function figureInput(amount: number | null | undefined): string {
	if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
	return amount.toFixed(2);
}

const FORM_PATTERNS: [string, RegExp][] = [
	['1099-NEC', /1099[\s-]?NEC\b/i],
	['1099-INT', /1099[\s-]?INT\b/i],
	['1099-DIV', /1099[\s-]?DIV\b/i],
	['1099-B', /1099[\s-]?B\b/i],
	['1099-R', /1099[\s-]?R\b/i],
	['1099-G', /1099[\s-]?G\b/i],
	['1099-K', /1099[\s-]?K\b/i],
	['1098-T', /1098[\s-]?T\b/i],
	['1095-A', /1095[\s-]?A\b/i],
	['1098', /\b1098\b/],
	['K-1', /Schedule\s+K[\s-]?1\b/i],
	['W-2', /\bW[\s-]?2\b/]
];

/** Guess which form a page of text comes from, using the printed form name. */
export function detectFormType(text: string): string | null {
	const t = text.replace(/\s+/g, ' ');
	// A consolidated 1099 mentions several forms; count mentions and prefer the most frequent
	let best: { form: string; count: number } | null = null;
	for (const [form, pattern] of FORM_PATTERNS) {
		if (!FORM_TYPES.includes(form)) continue;
		const count = (t.match(new RegExp(pattern.source, pattern.flags + 'g')) ?? []).length;
		if (count > 0 && (!best || count > best.count)) best = { form, count };
	}
	return best?.form ?? null;
}

/** Guess the tax year from "2025" style mentions near the top of a form. */
export function detectYear(text: string): number | null {
	const m = text.match(/\b(20\d{2})\b/g);
	if (!m) return null;
	const counts = new Map<number, number>();
	for (const y of m) counts.set(Number(y), (counts.get(Number(y)) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface TextItem extends Rect {
	text: string;
}

/** Text items whose centre falls inside a rectangle, in reading order, joined. */
export function textInRect(items: TextItem[], rect: Rect): string {
	const inside = items.filter((it) => {
		const cx = it.x + it.w / 2;
		const cy = it.y + it.h / 2;
		return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
	});
	inside.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
	return inside
		.map((it) => it.text.trim())
		.filter(Boolean)
		.join(' ');
}

/** The smallest rectangle covering some items, padded a little for display. */
export function boundsOf(items: Rect[], pad = 0.002): Rect | null {
	if (items.length === 0) return null;
	const x = Math.min(...items.map((i) => i.x)) - pad;
	const y = Math.min(...items.map((i) => i.y)) - pad;
	const r = Math.max(...items.map((i) => i.x + i.w)) + pad;
	const b = Math.max(...items.map((i) => i.y + i.h)) + pad;
	return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1, r) - Math.max(0, x), h: Math.min(1, b) - Math.max(0, y) };
}
