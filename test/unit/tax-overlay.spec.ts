import { describe, it, expect } from 'bun:test';
import { overlayDocumentFigures, bookFigureForAccount } from '$lib/server/actions/taxTotals';

// Dividends account: some received in a Vanguard brokerage account, some in a Betterment one
const dividendRows = [
	{ accountId: 'div', counterpartyId: 'vanguard', total: 98.29 },
	{ accountId: 'div', counterpartyId: 'betterment', total: 697.83 }
];

describe('overlayDocumentFigures', () => {
	it('replaces only the share from the account a document is tied to', () => {
		// Only the Vanguard 1099-DIV is on hand, and it reports a little more than the books
		const result = overlayDocumentFigures('INCOME', dividendRows, [{ accountId: 'vanguard', amount: 100 }]);
		expect(result.bookTotal).toBeCloseTo(796.12);
		expect(result.documentTotal).toBe(100);
		expect(result.bookReplaced).toBeCloseTo(98.29);
		expect(result.reportedTotal).toBeCloseTo(697.83 + 100);
	});

	it('replaces each account share when both documents are on hand', () => {
		const result = overlayDocumentFigures('INCOME', dividendRows, [
			{ accountId: 'vanguard', amount: 98.29 },
			{ accountId: 'betterment', amount: 700 }
		]);
		expect(result.bookReplaced).toBeCloseTo(796.12);
		expect(result.reportedTotal).toBeCloseTo(798.29);
	});

	it('adds a document for an account with no transactions in the category', () => {
		const result = overlayDocumentFigures('INCOME', dividendRows, [{ accountId: 'schwab', amount: 50 }]);
		expect(result.bookReplaced).toBe(0);
		expect(result.reportedTotal).toBeCloseTo(846.12);
	});

	it('replaces the whole category for a document without an account', () => {
		const result = overlayDocumentFigures('INCOME', dividendRows, [{ accountId: null, amount: 500 }]);
		expect(result.bookReplaced).toBeCloseTo(796.12);
		expect(result.reportedTotal).toBe(500);
	});

	it('replaces an expense account the document points at directly', () => {
		const rows = [
			{ accountId: 'mortgage-interest', counterpartyId: 'mortgage', total: 9145.07 },
			{ accountId: 'points', counterpartyId: 'checking', total: 300 }
		];
		const result = overlayDocumentFigures('EXPENSE', rows, [{ accountId: 'mortgage-interest', amount: 9145.07 }]);
		expect(result.bookReplaced).toBeCloseTo(9145.07);
		expect(result.reportedTotal).toBeCloseTo(9445.07);
	});

	it('replaces an expense category when the document account has no rows in it', () => {
		// A 1098 tied to the mortgage interest account also reports real estate taxes
		const rows = [{ accountId: 'property-tax', counterpartyId: 'mortgage', total: 8821.46 }];
		const result = overlayDocumentFigures('EXPENSE', rows, [{ accountId: 'mortgage-interest', amount: 8821.46 }]);
		expect(result.bookReplaced).toBeCloseTo(8821.46);
		expect(result.reportedTotal).toBeCloseTo(8821.46);
	});

	it('works for a category with no book rows at all', () => {
		const result = overlayDocumentFigures('INCOME', [], [{ accountId: 'vanguard', amount: 91.98 }]);
		expect(result.reportedTotal).toBeCloseTo(91.98);
	});
});

describe('bookFigureForAccount', () => {
	it('sums the rows attributable to an account and says whether there were any', () => {
		expect(bookFigureForAccount(dividendRows, 'vanguard')).toEqual({ amount: 98.29, hasRows: true });
		expect(bookFigureForAccount(dividendRows, 'div').amount).toBeCloseTo(796.12);
		expect(bookFigureForAccount(dividendRows, 'schwab')).toEqual({ amount: 0, hasRows: false });
	});
});
