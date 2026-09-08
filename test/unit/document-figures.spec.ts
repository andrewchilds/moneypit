import { describe, it, expect } from 'bun:test';
import { parseFigure, looksLikeFigure, detectFormType, textInRect, figureInput } from '../../src/lib/documentFigures';

describe('parseFigure', () => {
	it('reads plain and formatted amounts', () => {
		expect(parseFigure('412.34')).toBe(412.34);
		expect(parseFigure('$ 1,250.00')).toBe(1250);
		expect(parseFigure('$1,234,567.89')).toBe(1234567.89);
	});

	it('takes the last number when a label precedes it', () => {
		expect(parseFigure('1 Interest income $ 412.34')).toBe(412.34);
		expect(parseFigure('Box 3 Interest on U.S. Savings Bonds 1,250.00')).toBe(1250);
	});

	it('treats parentheses and minus signs as negative', () => {
		expect(parseFigure('(1,200.00)')).toBe(-1200);
		expect(parseFigure('-55.10')).toBe(-55.1);
	});

	it('ignores a leading box number on a label', () => {
		expect(parseFigure('9 Specified private activity bond interest')).toBeNull();
		expect(parseFigure('9 Specified private activity bond interest $ 55')).toBe(55);
		expect(parseFigure('14 Tax-exempt and tax credit bond CUSIP no.')).toBeNull();
		expect(parseFigure('75')).toBe(75);
	});

	it('returns null when there is no number', () => {
		expect(parseFigure('Interest income')).toBeNull();
		expect(parseFigure('$')).toBeNull();
		expect(parseFigure('')).toBeNull();
	});
});

describe('looksLikeFigure', () => {
	it('accepts amounts on their own', () => {
		for (const t of ['412.34', '$ 412.34', '1,250.00', '(1,200.00)', '0.00', '75', '$1,234,567.89']) {
			expect(looksLikeFigure(t)).toBe(true);
		}
	});

	it('rejects labels, ids, and dates', () => {
		for (const t of ['1 Interest income', '12-3456789', 'XXX-XX-4321', '01/15/2025', 'PO Box 951', '']) {
			expect(looksLikeFigure(t)).toBe(false);
		}
	});
});

describe('detectFormType', () => {
	it('finds the printed form name', () => {
		expect(detectFormType('Form 1099-INT Interest Income Copy B')).toBe('1099-INT');
		expect(detectFormType('Form W-2 Wage and Tax Statement 2025')).toBe('W-2');
		expect(detectFormType('Schedule K-1 (Form 1065)')).toBe('K-1');
		expect(detectFormType('Form 1098-T Tuition Statement')).toBe('1098-T');
		expect(detectFormType('Form 1098 Mortgage Interest Statement')).toBe('1098');
	});

	it('prefers the most-mentioned form on a consolidated statement', () => {
		const text = 'Consolidated 1099. 1099-DIV summary. 1099-B proceeds. 1099-B details. 1099-B wash sales.';
		expect(detectFormType(text)).toBe('1099-B');
	});

	it('returns null for unknown text', () => {
		expect(detectFormType('Monthly statement')).toBeNull();
	});
});

describe('textInRect', () => {
	const items = [
		{ text: '1 Interest income', x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
		{ text: '$', x: 0.1, y: 0.14, w: 0.01, h: 0.02 },
		{ text: '412.34', x: 0.25, y: 0.14, w: 0.05, h: 0.02 },
		{ text: 'elsewhere', x: 0.7, y: 0.7, w: 0.1, h: 0.02 }
	];

	it('joins the items inside a rectangle in reading order', () => {
		expect(textInRect(items, { x: 0.05, y: 0.05, w: 0.4, h: 0.15 })).toBe('1 Interest income $ 412.34');
	});

	it('ignores items outside', () => {
		expect(textInRect(items, { x: 0.2, y: 0.13, w: 0.2, h: 0.04 })).toBe('412.34');
		expect(textInRect(items, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe('');
	});
});

describe('figureInput', () => {
	it('formats with two decimals and blanks nulls', () => {
		expect(figureInput(412.3)).toBe('412.30');
		expect(figureInput(null)).toBe('');
		expect(figureInput(undefined)).toBe('');
	});
});
