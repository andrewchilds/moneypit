/**
 * Figures that change every tax year: brackets, the standard deduction,
 * thresholds and caps. One table per year; the computation reads them and
 * never hard-codes a dollar amount. Adding a year is adding a table here.
 */

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh' | 'qss';

export const FILING_STATUSES: FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh', 'qss'];

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
	single: 'Single',
	mfj: 'Married filing jointly',
	mfs: 'Married filing separately',
	hoh: 'Head of household',
	qss: 'Qualifying surviving spouse'
};

export interface Bracket {
	rate: number;
	/** Taxable income this bracket runs up to; null for the top bracket */
	upTo: number | null;
}

type ByStatus<T = number> = Record<FilingStatus, T>;

export interface TaxYearConstants {
	year: number;
	standardDeduction: ByStatus;
	/** Per box checked on line 12d (65 or older, blind); married statuses use `married` */
	additionalStandardDeduction: { single: number; married: number };
	brackets: ByStatus<Bracket[]>;
	/** Qualified dividends and long-term gains: taxed at 0% up to, 15% up to, 20% above */
	capitalGains: ByStatus<{ zeroUpTo: number; fifteenUpTo: number }>;
	/** Net capital loss deductible against other income (Form 1040 line 7) */
	capitalLossLimit: ByStatus;
	selfEmployment: {
		/** Net profit × this is net earnings from self-employment (Schedule SE line 4a) */
		earningsFactor: number;
		socialSecurityRate: number;
		socialSecurityWageBase: number;
		medicareRate: number;
		/** Below this in net earnings there is no SE tax */
		minimumEarnings: number;
	};
	additionalMedicare: { rate: number; threshold: ByStatus };
	netInvestmentIncome: { rate: number; threshold: ByStatus };
	qualifiedBusinessIncome: {
		rate: number;
		/** Taxable income before the deduction at or below which Form 8995 applies in full */
		threshold: ByStatus;
		/** Width of the range above the threshold over which the deduction phases out */
		phaseInRange: ByStatus;
	};
	salt: {
		cap: ByStatus;
		/** Cap is reduced by `rate` × (AGI − threshold), not below `floor`; null when there is no reduction */
		phaseDown: { threshold: ByStatus; rate: number; floor: ByStatus } | null;
	};
	medicalFloorRate: number;
	childTaxCredit: {
		perChild: number;
		perOtherDependent: number;
		phaseOutStart: ByStatus;
		/** Credit drops by this much for each $1,000 (or part) of AGI over the start */
		reductionPerThousand: number;
	};
}

const same = (single: number, mfj: number, mfs = single, hoh = single): ByStatus => ({ single, mfj, mfs, hoh, qss: mfj });

function brackets(edges: number[]): Bracket[] {
	const rates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
	return rates.map((rate, i) => ({ rate, upTo: i < edges.length ? edges[i] : null }));
}

const tax2025: TaxYearConstants = {
	year: 2025,
	standardDeduction: same(15750, 31500, 15750, 23625),
	additionalStandardDeduction: { single: 2000, married: 1600 },
	brackets: {
		single: brackets([11925, 48475, 103350, 197300, 250525, 626350]),
		mfj: brackets([23850, 96950, 206700, 394600, 501050, 751600]),
		mfs: brackets([11925, 48475, 103350, 197300, 250525, 375800]),
		hoh: brackets([17000, 64850, 103350, 197300, 250500, 626350]),
		qss: brackets([23850, 96950, 206700, 394600, 501050, 751600])
	},
	capitalGains: {
		single: { zeroUpTo: 48350, fifteenUpTo: 533400 },
		mfj: { zeroUpTo: 96700, fifteenUpTo: 600050 },
		mfs: { zeroUpTo: 48350, fifteenUpTo: 300000 },
		hoh: { zeroUpTo: 64750, fifteenUpTo: 566700 },
		qss: { zeroUpTo: 96700, fifteenUpTo: 600050 }
	},
	capitalLossLimit: same(3000, 3000, 1500),
	selfEmployment: { earningsFactor: 0.9235, socialSecurityRate: 0.124, socialSecurityWageBase: 176100, medicareRate: 0.029, minimumEarnings: 400 },
	additionalMedicare: { rate: 0.009, threshold: same(200000, 250000, 125000) },
	netInvestmentIncome: { rate: 0.038, threshold: same(200000, 250000, 125000) },
	qualifiedBusinessIncome: { rate: 0.2, threshold: same(197300, 394600), phaseInRange: same(50000, 100000) },
	salt: {
		cap: same(40000, 40000, 20000),
		phaseDown: { threshold: same(500000, 500000, 250000), rate: 0.3, floor: same(10000, 10000, 5000) }
	},
	medicalFloorRate: 0.075,
	childTaxCredit: { perChild: 2200, perOtherDependent: 500, phaseOutStart: same(200000, 400000), reductionPerThousand: 50 }
};

const tax2024: TaxYearConstants = {
	year: 2024,
	standardDeduction: same(14600, 29200, 14600, 21900),
	additionalStandardDeduction: { single: 1950, married: 1550 },
	brackets: {
		single: brackets([11600, 47150, 100525, 191950, 243725, 609350]),
		mfj: brackets([23200, 94300, 201050, 383900, 487450, 731200]),
		mfs: brackets([11600, 47150, 100525, 191950, 243725, 365600]),
		hoh: brackets([16550, 63100, 100500, 191950, 243700, 609350]),
		qss: brackets([23200, 94300, 201050, 383900, 487450, 731200])
	},
	capitalGains: {
		single: { zeroUpTo: 47025, fifteenUpTo: 518900 },
		mfj: { zeroUpTo: 94050, fifteenUpTo: 583750 },
		mfs: { zeroUpTo: 47025, fifteenUpTo: 291850 },
		hoh: { zeroUpTo: 63000, fifteenUpTo: 551350 },
		qss: { zeroUpTo: 94050, fifteenUpTo: 583750 }
	},
	capitalLossLimit: same(3000, 3000, 1500),
	selfEmployment: { earningsFactor: 0.9235, socialSecurityRate: 0.124, socialSecurityWageBase: 168600, medicareRate: 0.029, minimumEarnings: 400 },
	additionalMedicare: { rate: 0.009, threshold: same(200000, 250000, 125000) },
	netInvestmentIncome: { rate: 0.038, threshold: same(200000, 250000, 125000) },
	qualifiedBusinessIncome: { rate: 0.2, threshold: same(191950, 383900), phaseInRange: same(50000, 100000) },
	salt: { cap: same(10000, 10000, 5000), phaseDown: null },
	medicalFloorRate: 0.075,
	childTaxCredit: { perChild: 2000, perOtherDependent: 500, phaseOutStart: same(200000, 400000), reductionPerThousand: 50 }
};

const TABLES: Record<number, TaxYearConstants> = { 2024: tax2024, 2025: tax2025 };

export function getTaxYearConstants(year: number): TaxYearConstants | null {
	return TABLES[year] ?? null;
}

export function supportedTaxYears(): number[] {
	return Object.keys(TABLES)
		.map(Number)
		.sort((a, b) => a - b);
}
