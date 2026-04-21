import { readFile } from 'fs/promises';
import { parse as parseOFXContent } from 'ofx-js';

export interface ParsedTransaction {
	date: Date;
	amount: number;
	description: string;
	memo?: string;
	fitid?: string;
}

function parseOFXDate(dateStr: string): Date {
	// OFX dates are YYYYMMDD or YYYYMMDDHHMMSS
	const year = parseInt(dateStr.slice(0, 4), 10);
	const month = parseInt(dateStr.slice(4, 6), 10) - 1;
	const day = parseInt(dateStr.slice(6, 8), 10);
	return new Date(year, month, day);
}

export async function parseOFX(filePath: string): Promise<ParsedTransaction[]> {
	const content = await readFile(filePath, 'utf-8');
	const parsed = await parseOFXContent(content);

	const transactions: ParsedTransaction[] = [];

	// Navigate OFX structure - can be bank statement or credit card statement
	const stmtrs =
		parsed.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS ||
		parsed.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS;

	if (!stmtrs) {
		throw new Error('No statement found in OFX file');
	}

	const tranList = stmtrs.BANKTRANLIST?.STMTTRN || [];
	const transArray = Array.isArray(tranList) ? tranList : [tranList];

	for (const trn of transArray) {
		if (!trn.DTPOSTED || !trn.TRNAMT) continue;

		const date = parseOFXDate(trn.DTPOSTED);
		const amount = parseFloat(trn.TRNAMT);
		const description = trn.NAME || trn.MEMO || 'Unknown';
		const memo = trn.NAME && trn.MEMO ? trn.MEMO : undefined;
		const fitid = trn.FITID;

		transactions.push({
			date,
			amount,
			description,
			memo,
			fitid
		});
	}

	return transactions;
}
