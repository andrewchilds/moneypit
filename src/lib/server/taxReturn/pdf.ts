/**
 * Fill the IRS fillable PDFs with a computed return. The blank forms live in
 * `forms/irs/<year>/` (downloaded from irs.gov/pub/irs-prior); each form's
 * line keys map to the AcroForm field names on that year's PDF. Filled
 * forms are flattened so several Schedule Cs can sit in one file, and the
 * result is one PDF in filing order.
 */

import { PDFDocument, PDFCheckBox, PDFTextField, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import type { FormId, ReturnComputation, ReturnForm } from './compute';

/**
 * Line key -> field name suffix ("f1_47[0]"); checks are full-name suffixes
 * too. A list of suffixes is a comb spread over several one-character
 * fields (a year of birth).
 */
interface FormFieldMap {
	file: string;
	fields: Record<string, string | string[]>;
	checks: Record<string, string>;
	/** Lines whose parentheses are pre-printed on the form, so a loss prints without its own */
	parenthesized?: string[];
	/** Further fields that take a line's value as well (the name repeated on page 2) */
	repeat?: Record<string, string[]>;
}

const seq = (prefix: string, from: number, count: number, step = 1, pad = 2): string[] =>
	Array.from({ length: count }, (_, i) => `${prefix}${String(from + i * step).padStart(pad, '0')}[0]`);

function scheduleBFields(): Record<string, string> {
	const fields: Record<string, string> = { name: 'f1_01[0]', ssn: 'f1_02[0]', '2': 'f1_31[0]', '4': 'f1_33[0]', '6': 'f1_64[0]' };
	seq('f1_', 3, 14, 2).forEach((f, i) => (fields[`1.payer.${i + 1}`] = f));
	seq('f1_', 4, 14, 2).forEach((f, i) => (fields[`1.amount.${i + 1}`] = f));
	seq('f1_', 34, 15, 2).forEach((f, i) => (fields[`5.payer.${i + 1}`] = f));
	seq('f1_', 35, 15, 2).forEach((f, i) => (fields[`5.amount.${i + 1}`] = f));
	return fields;
}

/** The Form 1040 dependents table: four columns of first name, last name, SSN and relationship */
function dependentTableFields(): Record<string, string> {
	const fields: Record<string, string> = {};
	for (let n = 1; n <= 4; n++) {
		fields[`dep.first.${n}`] = `f1_${30 + n}[0]`;
		fields[`dep.last.${n}`] = `f1_${34 + n}[0]`;
		fields[`dep.ssn.${n}`] = `f1_${38 + n}[0]`;
		fields[`dep.rel.${n}`] = `f1_${42 + n}[0]`;
	}
	return fields;
}

/** Its check boxes: (5) lived with you and in the U.S., (6) student or disabled, (7) which credit */
function dependentTableChecks(): Record<string, string> {
	const checks: Record<string, string> = {};
	for (let n = 1; n <= 4; n++) {
		checks[`dep.lived.${n}`] = `Dependent${n}[0].c1_${10 + 2 * n}[0]`;
		checks[`dep.us.${n}`] = `Dependent${n}[0].c1_${11 + 2 * n}[0]`;
		checks[`dep.student.${n}`] = `Dependent${n}[0].c1_${18 + 2 * n}[0]`;
		checks[`dep.disabled.${n}`] = `Dependent${n}[0].c1_${19 + 2 * n}[0]`;
		checks[`dep.ctc.${n}`] = `Dependent${n}[0].c1_${27 + n}[0]`;
		checks[`dep.odc.${n}`] = `Dependent${n}[0].c1_${27 + n}[1]`;
	}
	return checks;
}

function scheduleCPartVFields(): Record<string, string> {
	const fields: Record<string, string> = { '48': 'f2_33[0]' };
	for (let n = 1; n <= 9; n++) {
		fields[`48.desc.${n}`] = `f2_${13 + 2 * n}[0]`;
		fields[`48.amount.${n}`] = `f2_${14 + 2 * n}[0]`;
	}
	return fields;
}

/** Form 6781 Part I: three line 1 rows of account, loss and gain, line 2 in two columns, then lines 3 to 9 */
function form6781Fields(): Record<string, string> {
	const fields: Record<string, string> = { name: 'f1_01[0]', ssn: 'f1_02[0]', '2.loss': 'f1_12[0]', '2.gain': 'f1_13[0]' };
	for (let n = 1; n <= 3; n++) {
		fields[`1.desc.${n}`] = `f1_${String(3 * n).padStart(2, '0')}[0]`;
		fields[`1.loss.${n}`] = `f1_${String(3 * n + 1).padStart(2, '0')}[0]`;
		fields[`1.gain.${n}`] = `f1_${String(3 * n + 2).padStart(2, '0')}[0]`;
	}
	['3', '4', '5', '6', '7', '8', '9'].forEach((line, i) => (fields[line] = `f1_${14 + i}[0]`));
	return fields;
}

/**
 * Form 8949: Part I on page 1 and Part II on page 2, each ROWS_PER_PAGE rows
 * of eight fields (description, dates, proceeds, basis, code, adjustment,
 * gain) and a totals line with four.
 */
function form8949Fields(): Record<string, string> {
	const fields: Record<string, string> = { name: 'f1_01[0]', ssn: 'f1_02[0]' };
	const columns = ['desc', 'acq', 'sold', 'proc', 'basis', 'code', 'adj', 'gain'];
	for (const [part, prefix] of [
		['I', 'f1_'],
		['II', 'f2_']
	]) {
		for (let n = 1; n <= 11; n++) {
			columns.forEach((column, i) => (fields[`${part}.${n}.${column}`] = `${prefix}${String(3 + 8 * (n - 1) + i).padStart(2, '0')}[0]`));
		}
		fields[`${part}.total.proc`] = `${prefix}91[0]`;
		fields[`${part}.total.basis`] = `${prefix}92[0]`;
		fields[`${part}.total.adj`] = `${prefix}94[0]`;
		fields[`${part}.total.gain`] = `${prefix}95[0]`;
	}
	return fields;
}

function form8949Checks(): Record<string, string> {
	const checks: Record<string, string> = {};
	['A', 'B', 'C', 'G', 'H', 'I'].forEach((box, i) => (checks[`box:${box}`] = `c1_1[${i}]`));
	['D', 'E', 'F', 'J', 'K', 'L'].forEach((box, i) => (checks[`box:${box}`] = `c2_1[${i}]`));
	return checks;
}

/** Schedule D Parts I and II: four columns (proceeds, basis, adjustments, gain) on the Form 8949 lines, one on the rest */
function scheduleDFields(): Record<string, string> {
	const fields: Record<string, string> = { name: 'f1_1[0]', ssn: 'f1_2[0]', '16': 'f2_1[0]', '18': 'f2_2[0]', '19': 'f2_3[0]', '21': 'f2_4[0]' };
	const rows: [string, number][] = [
		['1a', 3],
		['1b', 7],
		['2', 11],
		['3', 15],
		['8a', 23],
		['8b', 27],
		['9', 31],
		['10', 35]
	];
	for (const [line, first] of rows) {
		fields[`${line}.proc`] = `f1_${first}[0]`;
		fields[`${line}.basis`] = `f1_${first + 1}[0]`;
		fields[`${line}.adj`] = `f1_${first + 2}[0]`;
		fields[line] = `f1_${first + 3}[0]`;
	}
	const singles: [string, number][] = [
		['4', 19],
		['5', 20],
		['6', 21],
		['7', 22],
		['11', 39],
		['12', 40],
		['13', 41],
		['14', 42],
		['15', 43]
	];
	for (const [line, n] of singles) fields[line] = `f1_${n}[0]`;
	return fields;
}

function scheduleEICFields(): Record<string, string | string[]> {
	const fields: Record<string, string | string[]> = { name: 'f1_01[0]', ssn: 'f1_02[0]' };
	for (let n = 1; n <= 3; n++) {
		fields[`1.name.${n}`] = `f1_${String(2 + n).padStart(2, '0')}[0]`;
		fields[`2.ssn.${n}`] = `f1_${String(5 + n).padStart(2, '0')}[0]`;
		fields[`3.year.${n}`] = seq('f1_', 9 + 4 * (n - 1), 4);
		fields[`5.rel.${n}`] = `f1_${20 + n}[0]`;
		fields[`6.months.${n}`] = `f1_${23 + n}[0]`;
	}
	return fields;
}

const MAPS_2025: Record<FormId, FormFieldMap> = {
	f1040: {
		file: 'f1040.pdf',
		fields: {
			firstName: 'f1_14[0]',
			lastName: 'f1_15[0]',
			ssn: 'f1_16[0]',
			spouseFirstName: 'f1_17[0]',
			spouseLastName: 'f1_18[0]',
			spouseSsn: 'f1_19[0]',
			street: 'f1_20[0]',
			apt: 'f1_21[0]',
			city: 'f1_22[0]',
			state: 'f1_23[0]',
			zip: 'f1_24[0]',
			occupation: 'f2_40[0]',
			spouseOccupation: 'f2_42[0]',
			'1a': 'f1_47[0]',
			'1z': 'f1_57[0]',
			'2a': 'f1_58[0]',
			'2b': 'f1_59[0]',
			'3a': 'f1_60[0]',
			'3b': 'f1_61[0]',
			'4a': 'f1_62[0]',
			'4b': 'f1_63[0]',
			'7': 'f1_70[0]',
			'8': 'f1_72[0]',
			'9': 'f1_73[0]',
			'10': 'f1_74[0]',
			'11': 'f1_75[0]',
			'11b': 'f2_01[0]',
			'12e': 'f2_02[0]',
			'13a': 'f2_03[0]',
			'14': 'f2_05[0]',
			'15': 'f2_06[0]',
			'16': 'f2_08[0]',
			'17': 'f2_09[0]',
			'18': 'f2_10[0]',
			'19': 'f2_11[0]',
			'20': 'f2_12[0]',
			'21': 'f2_13[0]',
			'22': 'f2_14[0]',
			'23': 'f2_15[0]',
			'24': 'f2_16[0]',
			'25a': 'f2_17[0]',
			'25b': 'f2_18[0]',
			'25c': 'f2_19[0]',
			'25d': 'f2_20[0]',
			'26': 'f2_21[0]',
			'27a': 'f2_23[0]',
			'28': 'f2_24[0]',
			'31': 'f2_27[0]',
			'32': 'f2_28[0]',
			'33': 'f2_29[0]',
			'34': 'f2_30[0]',
			'35a': 'f2_31[0]',
			'37': 'f2_35[0]',
			...dependentTableFields()
		},
		checks: {
			...dependentTableChecks(),
			'dependents:more': 'c1_11[0]',
			'status:single': 'Page1[0].Checkbox_ReadOrder[0].c1_8[0]',
			'status:mfj': 'Page1[0].Checkbox_ReadOrder[0].c1_8[1]',
			'status:mfs': 'Page1[0].Checkbox_ReadOrder[0].c1_8[2]',
			'status:hoh': 'Page1[0].c1_8[0]',
			'status:qss': 'Page1[0].c1_8[1]',
			'age-or-blind:0': 'c2_5[0]',
			'age-or-blind:1': 'c2_6[0]',
			'age-or-blind:2': 'c2_7[0]',
			'age-or-blind:3': 'c2_8[0]'
		}
	},
	f1040s1: {
		file: 'f1040s1.pdf',
		fields: {
			name: 'f1_01[0]',
			ssn: 'f1_02[0]',
			'1': 'f1_04[0]',
			'2a': 'f1_05[0]',
			'3': 'f1_07[0]',
			'4': 'f1_08[0]',
			'5': 'f1_09[0]',
			'6': 'f1_10[0]',
			'7': 'f1_12[0]',
			'8a': 'f1_13[0]',
			'8z': 'f1_36[0]',
			'9': 'f1_37[0]',
			'10': 'f1_38[0]',
			'11': 'f2_01[0]',
			'12': 'f2_02[0]',
			'13': 'f2_03[0]',
			'14': 'f2_04[0]',
			'15': 'f2_05[0]',
			'16': 'f2_06[0]',
			'17': 'f2_07[0]',
			'18': 'f2_08[0]',
			'19a': 'f2_09[0]',
			'20': 'f2_12[0]',
			'21': 'f2_13[0]',
			'23': 'f2_15[0]',
			'26': 'f2_30[0]'
		},
		checks: {},
		parenthesized: ['8a']
	},
	f1040s2: {
		file: 'f1040s2.pdf',
		fields: { name: 'f1_01[0]', ssn: 'f1_02[0]', '3': 'f1_13[0]', '4': 'f1_15[0]', '11': 'f1_22[0]', '12': 'f1_23[0]', '21': 'f2_24[0]' },
		checks: {}
	},
	f1040s3: {
		file: 'f1040s3.pdf',
		fields: { name: 'f1_01[0]', ssn: 'f1_02[0]', '8': 'f1_25[0]', '10': 'f1_27[0]', '15': 'f1_37[0]' },
		checks: {}
	},
	f1040sa: {
		file: 'f1040sa.pdf',
		fields: {
			name: 'f1_1[0]',
			ssn: 'f1_2[0]',
			'1': 'f1_3[0]',
			'2': 'f1_4[0]',
			'3': 'f1_5[0]',
			'4': 'f1_6[0]',
			'5a': 'f1_7[0]',
			'5b': 'f1_8[0]',
			'5c': 'f1_9[0]',
			'5d': 'f1_10[0]',
			'5e': 'f1_11[0]',
			'7': 'f1_14[0]',
			'8a': 'f1_15[0]',
			'8e': 'f1_20[0]',
			'10': 'f1_22[0]',
			'11': 'f1_23[0]',
			'12': 'f1_24[0]',
			'14': 'f1_26[0]',
			'17': 'f1_30[0]'
		},
		checks: {}
	},
	f1040sb: { file: 'f1040sb.pdf', fields: scheduleBFields(), checks: {} },
	f1040sc: {
		file: 'f1040sc.pdf',
		fields: {
			name: 'f1_1[0]',
			ssn: 'f1_2[0]',
			A: 'f1_3[0]',
			B: 'f1_4[0]',
			C: 'f1_5[0]',
			'1': 'f1_10[0]',
			'2': 'f1_11[0]',
			'3': 'f1_12[0]',
			'4': 'f1_13[0]',
			'5': 'f1_14[0]',
			'6': 'f1_15[0]',
			'7': 'f1_16[0]',
			'8': 'f1_17[0]',
			'9': 'f1_18[0]',
			'10': 'f1_19[0]',
			'11': 'f1_20[0]',
			'12': 'f1_21[0]',
			'13': 'f1_22[0]',
			'14': 'f1_23[0]',
			'15': 'f1_24[0]',
			'16a': 'f1_25[0]',
			'16b': 'f1_26[0]',
			'17': 'f1_27[0]',
			'18': 'f1_28[0]',
			'19': 'f1_29[0]',
			'20a': 'f1_30[0]',
			'20b': 'f1_31[0]',
			'21': 'f1_32[0]',
			'22': 'f1_33[0]',
			'23': 'f1_34[0]',
			'24a': 'f1_35[0]',
			'24b': 'f1_36[0]',
			'25': 'f1_37[0]',
			'26': 'f1_38[0]',
			'27a': 'f1_40[0]',
			'27b': 'f1_39[0]',
			'28': 'f1_41[0]',
			'29': 'f1_42[0]',
			'30': 'f1_45[0]',
			'31': 'f1_46[0]',
			...scheduleCPartVFields()
		},
		checks: { 'method:cash': 'c1_1[0]', 'method:accrual': 'c1_1[1]', 'materially-participated': 'c1_2[0]', '32a': 'c1_7[0]', '32b': 'c1_7[1]' }
	},
	f1040sd: {
		file: 'f1040sd.pdf',
		fields: scheduleDFields(),
		checks: { 'qof:yes': 'c1_1[0]', 'qof:no': 'c1_1[1]', '17:yes': 'c2_1[0]', '17:no': 'c2_1[1]', '20:yes': 'c2_2[0]', '20:no': 'c2_2[1]', '22:yes': 'c2_3[0]', '22:no': 'c2_3[1]' },
		parenthesized: ['6', '14', '21']
	},
	f8949: {
		file: 'f8949.pdf',
		fields: form8949Fields(),
		checks: form8949Checks(),
		repeat: { name: ['f2_01[0]'], ssn: ['f2_02[0]'] }
	},
	f1040sse: {
		file: 'f1040sse.pdf',
		fields: {
			name: 'f1_1[0]',
			ssn: 'f1_2[0]',
			'2': 'f1_5[0]',
			'3': 'f1_6[0]',
			'4a': 'f1_7[0]',
			'4c': 'f1_9[0]',
			'6': 'f1_12[0]',
			'8a': 'f1_14[0]',
			'8d': 'f1_17[0]',
			'9': 'f1_18[0]',
			'10': 'f1_19[0]',
			'11': 'f1_20[0]',
			'12': 'f1_21[0]',
			'13': 'f1_22[0]'
		},
		checks: {}
	},
	f1040sei: {
		file: 'f1040sei.pdf',
		fields: scheduleEICFields(),
		checks: {
			'4a.yes.1': 'Line4a_Child1_ReadOrder[0].Yes_ReadOrder[0].c1_1[0]',
			'4a.no.1': 'Line4a_Child1_ReadOrder[0].c1_1[0]',
			'4a.yes.2': 'Line4a_Child2_ReadOrder[0].Yes_ReadOrder[0].c1_2[0]',
			'4a.no.2': 'Line4a_Child2_ReadOrder[0].c1_2[0]',
			'4a.yes.3': 'Line4a_Child3_Yes_ReadOrder[0].c1_3[0]',
			'4a.no.3': 'Page1[0].c1_3[0]',
			'4b.yes.1': 'Line4b_Child1_ReadOrder[0].Yes_ReadOrder[0].c1_4[0]',
			'4b.yes.2': 'Line4b_Child2_ReadOrder[0].Yes_ReadOrder[0].c1_5[0]',
			'4b.yes.3': 'Line4b_Child3_Yes_ReadOrder[0].c1_6[0]'
		}
	},
	f1040s8: {
		file: 'f1040s8.pdf',
		fields: {
			name: 'f1_1[0]',
			ssn: 'f1_2[0]',
			'1': 'f1_3[0]',
			'2d': 'f1_7[0]',
			'3': 'f1_8[0]',
			'4': 'f1_9[0]',
			'5': 'f1_10[0]',
			'6': 'f1_11[0]',
			'7': 'f1_12[0]',
			'8': 'f1_13[0]',
			'9': 'f1_14[0]',
			'10': 'f1_15[0]',
			'11': 'f1_16[0]',
			'12': 'f1_17[0]',
			'13': 'f1_18[0]',
			'14': 'f1_19[0]',
			'16a': 'f2_2[0]',
			'16b.count': 'f2_3[0]',
			'16b': 'f2_4[0]',
			'17': 'f2_5[0]',
			'18a': 'f2_6[0]',
			'19': 'f2_8[0]',
			'20': 'f2_9[0]',
			'21': 'f2_10[0]',
			'22': 'f2_11[0]',
			'23': 'f2_12[0]',
			'24': 'f2_13[0]',
			'25': 'f2_14[0]',
			'26': 'f2_15[0]',
			'27': 'f2_16[0]'
		},
		checks: { '12:no': 'c1_1[0]', '12:yes': 'c1_1[1]', '19:no': 'c2_1[0]', '19:yes': 'c2_1[1]', '20:no': 'c2_2[0]', '20:yes': 'c2_2[1]' }
	},
	f6781: {
		file: 'f6781.pdf',
		fields: form6781Fields(),
		checks: { 'election:A': 'c1_1[0]', 'election:B': 'c1_2[0]', 'election:C': 'c1_3[0]', 'election:D': 'c1_4[0]' },
		// Column (b) is headed "(Loss)" and line 2's column (b) has printed parentheses
		parenthesized: ['1.loss.1', '1.loss.2', '1.loss.3', '2.loss']
	},
	f8606: {
		file: 'f8606.pdf',
		// Name and number on page 1; Part III is on page 2, lines 19 to 25c in order
		fields: {
			name: 'f1_01[0]',
			ssn: 'f1_02[0]',
			'19': 'f2_07[0]',
			'20': 'f2_08[0]',
			'21': 'f2_09[0]',
			'22': 'f2_10[0]',
			'23': 'f2_11[0]',
			'24': 'f2_12[0]',
			'25a': 'f2_13[0]',
			'25b': 'f2_14[0]',
			'25c': 'f2_15[0]'
		},
		checks: {}
	},
	f8995: {
		file: 'f8995.pdf',
		fields: {
			name: 'f1_01[0]',
			ssn: 'f1_02[0]',
			'1i.name': 'f1_03[0]',
			'1i.qbi': 'f1_05[0]',
			'1ii.name': 'f1_06[0]',
			'1ii.qbi': 'f1_08[0]',
			'1iii.name': 'f1_09[0]',
			'1iii.qbi': 'f1_11[0]',
			'1iv.name': 'f1_12[0]',
			'1iv.qbi': 'f1_14[0]',
			'1v.name': 'f1_15[0]',
			'1v.qbi': 'f1_17[0]',
			'2': 'f1_18[0]',
			'3': 'f1_19[0]',
			'4': 'f1_20[0]',
			'5': 'f1_21[0]',
			'10': 'f1_26[0]',
			'11': 'f1_27[0]',
			'12': 'f1_28[0]',
			'13': 'f1_29[0]',
			'14': 'f1_30[0]',
			'15': 'f1_31[0]',
			'16': 'f1_32[0]'
		},
		checks: {},
		parenthesized: ['3', '16']
	}
};

const FIELD_MAPS: Record<number, Record<FormId, FormFieldMap>> = { 2025: MAPS_2025 };

export function formsDirectory(year: number): string {
	return path.join(process.cwd(), 'forms', 'irs', String(year));
}

/** Whether blank forms and a field map exist for a year */
export function canRenderYear(year: number): boolean {
	return FIELD_MAPS[year] !== undefined && fs.existsSync(formsDirectory(year));
}

/** Whole dollars, with a loss in parentheses, as the forms ask */
export function formatFormAmount(amount: number): string {
	const whole = Math.round(Math.abs(amount));
	const text = whole.toLocaleString('en-US');
	return amount < 0 ? `(${text})` : text;
}

/**
 * Lines that print on the form. Blank beats "0" on an input line the filer
 * didn't use, but totals and results always print.
 */
export function shouldPrint(line: ReturnForm['lines'][number]): boolean {
	if (line.kind === 'text') return !!line.text;
	if (line.amount === null) return false;
	return line.amount !== 0 || line.kind === 'total' || line.kind === 'result';
}

async function fillForm(form: ReturnForm, map: FormFieldMap, year: number): Promise<PDFDocument> {
	const bytes = fs.readFileSync(path.join(formsDirectory(year), map.file));
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
	const acro = doc.getForm();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const fields = acro.getFields();
	const byName = (suffix: string) => fields.find((f) => f.getName() === suffix || f.getName().endsWith(`.${suffix}`));

	const setText = (suffix: string, text: string, size: number) => {
		const field = byName(suffix);
		if (!(field instanceof PDFTextField)) return;
		let value = text;
		// Comb fields (an SSN) take digits only and refuse anything past their length
		const maxLength = field.getMaxLength();
		if (maxLength !== undefined) value = value.replace(/[^A-Za-z0-9]/g, '').slice(0, maxLength);
		field.setText(value);
		field.setFontSize(size);
	};
	for (const line of form.lines) {
		if (!shouldPrint(line)) continue;
		const suffix = map.fields[line.line];
		if (!suffix) continue;
		const amount = map.parenthesized?.includes(line.line) ? Math.abs(line.amount ?? 0) : (line.amount ?? 0);
		const value = line.kind === 'text' ? (line.text ?? '') : formatFormAmount(amount);
		if (Array.isArray(suffix)) {
			// One character per field, as a year of birth is entered
			const chars = value.replace(/[^A-Za-z0-9]/g, '');
			suffix.forEach((s, i) => setText(s, chars[i] ?? '', 9));
		} else {
			setText(suffix, value, line.kind === 'text' ? 9 : 10);
			for (const also of map.repeat?.[line.line] ?? []) setText(also, value, line.kind === 'text' ? 9 : 10);
		}
	}
	for (const key of form.checks) {
		const suffix = map.checks[key];
		if (!suffix) continue;
		const field = byName(suffix);
		if (field instanceof PDFCheckBox) field.check();
	}
	acro.updateFieldAppearances(font);
	acro.flatten();
	return doc;
}

/** One PDF with every form of the return, in attachment sequence order; a form names the pages it uses when not all of them. */
export async function renderReturnPdf(computation: ReturnComputation): Promise<Uint8Array> {
	const year = computation.year;
	const maps = FIELD_MAPS[year];
	if (!maps || !fs.existsSync(formsDirectory(year))) {
		throw new Error(`No IRS forms on file for ${year} (expected them in ${formsDirectory(year)})`);
	}
	const out = await PDFDocument.create();
	out.setTitle(`Draft ${year} federal return`);
	for (const form of computation.forms) {
		const filled = await fillForm(form, maps[form.id], year);
		const pages = await out.copyPages(filled, form.pages ? form.pages.map((p) => p - 1) : filled.getPageIndices());
		for (const page of pages) out.addPage(page);
	}
	return out.save();
}
