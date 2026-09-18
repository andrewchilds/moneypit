/**
 * Form 8949 rows from a 1099-B document's lines. Pure, so the parsing can
 * be unit tested apart from the database.
 *
 * A broker's 1099-B summarises sales by the box they belong in on Form
 * 8949: A (short-term, basis reported to the IRS), B (short-term, basis
 * not reported), D and E (the long-term equivalents); C and F are for sales
 * with no 1099-B at all, and G to L are the same six for digital assets
 * reported on a 1099-DA. The document carries one row per box: the box
 * letter alone is the net gain or loss (the line the tax report uses), and
 * `<box>.proceeds`, `<box>.basis` and `<box>.adj.<code>` are the columns
 * Form 8949 prints (column (g) adjustments keep their code in the box name:
 * `A.adj.W` is a wash sale loss disallowed). A box with proceeds or basis
 * entered becomes a row; a box with only the net figure stays a net figure
 * on Schedule D line 1a or 8a.
 */

export interface CapitalGainAdjustment {
	/** Form 8949 column (f) code: W (wash sale), B (basis correction), ... */
	code: string;
	/** Column (g), signed as it changes the gain */
	amount: number;
}

export interface CapitalGainRow {
	/** Form 8949 box letter, A to L */
	box: string;
	description: string;
	dateAcquired: string;
	dateSold: string;
	proceeds: number;
	basis: number;
	adjustments: CapitalGainAdjustment[];
	/** The net gain or loss entered for the box, when it was; checked against the columns */
	reported: number | null;
}

export const SHORT_TERM_BOXES = ['A', 'B', 'C', 'G', 'H', 'I'] as const;
export const LONG_TERM_BOXES = ['D', 'E', 'F', 'J', 'K', 'L'] as const;

/** Rows Form 8949 holds per page in the 2025 revision */
export const ROWS_PER_PAGE = 11;

/** The Schedule D line each box's totals land on */
export const SCHEDULE_D_LINE: Record<string, string> = {
	A: '1b',
	G: '1b',
	B: '2',
	H: '2',
	C: '3',
	I: '3',
	D: '8b',
	J: '8b',
	E: '9',
	K: '9',
	F: '10',
	L: '10'
};

export const BOX_DESCRIPTIONS: Record<string, string> = {
	A: 'short-term, basis reported to the IRS',
	B: 'short-term, basis not reported to the IRS',
	C: 'short-term, not reported on a 1099-B',
	D: 'long-term, basis reported to the IRS',
	E: 'long-term, basis not reported to the IRS',
	F: 'long-term, not reported on a 1099-B',
	G: 'short-term digital assets, basis reported to the IRS',
	H: 'short-term digital assets, basis not reported to the IRS',
	I: 'short-term digital assets, not reported on a 1099-DA',
	J: 'long-term digital assets, basis reported to the IRS',
	K: 'long-term digital assets, basis not reported to the IRS',
	L: 'long-term digital assets, not reported on a 1099-DA'
};

export function isShortTermBox(box: string): boolean {
	return (SHORT_TERM_BOXES as readonly string[]).includes(box);
}

export type CapitalGainBoxKind = 'gain' | 'proceeds' | 'basis' | 'adj';

/** "A.adj.W" -> box A, an adjustment with code W; "b.basis" -> box B, basis; "D" -> box D, the net gain. Null for any other box name. */
export function parseCapitalGainBox(box: string): { box: string; kind: CapitalGainBoxKind; code?: string } | null {
	const m = box.trim().toUpperCase().match(/^([A-L])(?:\.(PROCEEDS|BASIS)|\.ADJ\.([A-Z]+))?$/);
	if (!m) return null;
	if (m[2]) return { box: m[1], kind: m[2].toLowerCase() as 'proceeds' | 'basis' };
	if (m[3]) return { box: m[1], kind: 'adj', code: m[3] };
	return { box: m[1], kind: 'gain' };
}

export interface CapitalGainLine {
	id: string;
	box: string;
	amount: number;
	taxCategoryId: string | null;
}

export interface ParsedCapitalGainRow {
	row: CapitalGainRow;
	/** The net gain line, when entered; its category is what the tax report counts it under */
	gainLine: CapitalGainLine | null;
}

/**
 * The rows a document's lines describe, one per box that has proceeds or
 * basis entered, and the ids of every line those rows consumed (the net
 * gain line included, whether or not it became a row's `reported`).
 */
export function rowsFromDocument(issuer: string, lines: CapitalGainLine[]): { rows: ParsedCapitalGainRow[]; consumed: string[] } {
	const byBox = new Map<string, { proceeds: number | null; basis: number | null; adjustments: CapitalGainAdjustment[]; gain: CapitalGainLine | null; ids: string[] }>();
	for (const line of lines) {
		const parsed = parseCapitalGainBox(line.box);
		if (!parsed) continue;
		let entry = byBox.get(parsed.box);
		if (!entry) {
			entry = { proceeds: null, basis: null, adjustments: [], gain: null, ids: [] };
			byBox.set(parsed.box, entry);
		}
		entry.ids.push(line.id);
		if (parsed.kind === 'proceeds') entry.proceeds = line.amount;
		else if (parsed.kind === 'basis') entry.basis = line.amount;
		else if (parsed.kind === 'adj') entry.adjustments.push({ code: parsed.code!, amount: line.amount });
		else entry.gain = line;
	}
	const rows: ParsedCapitalGainRow[] = [];
	const consumed: string[] = [];
	const order = [...SHORT_TERM_BOXES, ...LONG_TERM_BOXES] as readonly string[];
	for (const box of order) {
		const entry = byBox.get(box);
		if (!entry || (entry.proceeds === null && entry.basis === null)) continue;
		consumed.push(...entry.ids);
		rows.push({
			row: {
				box,
				description: `${issuer} - various`,
				dateAcquired: 'Various',
				dateSold: 'Various',
				proceeds: entry.proceeds ?? 0,
				basis: entry.basis ?? 0,
				adjustments: entry.adjustments.filter((a) => a.amount !== 0),
				reported: entry.gain ? entry.gain.amount : null
			},
			gainLine: entry.gain
		});
	}
	return { rows, consumed };
}
