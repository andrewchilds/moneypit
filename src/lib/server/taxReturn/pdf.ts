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

/** Line key -> field name suffix ("f1_47[0]"); checks are full-name suffixes too */
interface FormFieldMap {
	file: string;
	fields: Record<string, string>;
	checks: Record<string, string>;
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
			'31': 'f2_27[0]',
			'32': 'f2_28[0]',
			'33': 'f2_29[0]',
			'34': 'f2_30[0]',
			'35a': 'f2_31[0]',
			'37': 'f2_35[0]'
		},
		checks: {
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
		checks: {}
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
			'31': 'f1_46[0]'
		},
		checks: { 'method:cash': 'c1_1[0]', 'method:accrual': 'c1_1[1]', 'materially-participated': 'c1_2[0]' }
	},
	f1040sd: {
		file: 'f1040sd.pdf',
		fields: { name: 'f1_1[0]', ssn: 'f1_2[0]', '1a': 'f1_6[0]', '7': 'f1_22[0]', '8a': 'f1_26[0]', '15': 'f1_43[0]', '16': 'f2_1[0]', '21': 'f2_4[0]' },
		checks: {}
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
			'4': 'f1_20[0]',
			'5': 'f1_21[0]',
			'10': 'f1_26[0]',
			'11': 'f1_27[0]',
			'12': 'f1_28[0]',
			'13': 'f1_29[0]',
			'14': 'f1_30[0]',
			'15': 'f1_31[0]'
		},
		checks: {}
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

	for (const line of form.lines) {
		if (!shouldPrint(line)) continue;
		const suffix = map.fields[line.line];
		if (!suffix) continue;
		const field = byName(suffix);
		if (!(field instanceof PDFTextField)) continue;
		let value = line.kind === 'text' ? (line.text ?? '') : formatFormAmount(line.amount ?? 0);
		// Comb fields (an SSN) take digits only and refuse anything past their length
		const maxLength = field.getMaxLength();
		if (maxLength !== undefined) value = value.replace(/[^A-Za-z0-9]/g, '').slice(0, maxLength);
		field.setText(value);
		field.setFontSize(line.kind === 'text' ? 9 : 10);
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

/** One PDF with every form of the return, in attachment sequence order. */
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
		const pages = await out.copyPages(filled, filled.getPageIndices());
		for (const page of pages) out.addPage(page);
	}
	return out.save();
}
