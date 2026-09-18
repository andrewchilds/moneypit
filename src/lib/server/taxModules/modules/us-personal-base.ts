import type { TaxModule, TaxQuestion } from '../types';

/**
 * Who the dependents are, for the Form 1040 dependents table, Schedule 8812
 * and Schedule EIC. Asked for each dependent counted in `dependents`, up to
 * the four the form has room for.
 */
function dependentQuestions(): TaxQuestion[] {
	return [1, 2, 3, 4].flatMap((n): TaxQuestion[] => {
		const dependsOn = { key: 'dependents', min: n };
		const label = `Dependent ${n}`;
		return [
			{ key: `dependent_${n}_first_name`, prompt: `${label}: first name and middle initial`, type: 'text', carryForward: true, dependsOn },
			{ key: `dependent_${n}_last_name`, prompt: `${label}: last name`, type: 'text', carryForward: true, dependsOn },
			{ key: `dependent_${n}_ssn`, prompt: `${label}: social security number`, type: 'text', carryForward: true, dependsOn },
			{
				key: `dependent_${n}_relationship`,
				prompt: `${label}: relationship to you`,
				type: 'text',
				carryForward: true,
				dependsOn,
				description: 'Son, daughter, grandchild, parent, ...'
			},
			{
				key: `dependent_${n}_birth_year`,
				prompt: `${label}: year of birth`,
				type: 'number',
				carryForward: true,
				dependsOn,
				description: 'Decides the child tax credit (under 17) and the earned income credit (under 19, or under 24 as a student)'
			},
			{
				key: `dependent_${n}_months_lived`,
				prompt: `${label}: months lived with you in the U.S. this year`,
				type: 'number',
				dependsOn,
				description: 'Enter 12 for the whole year; more than 6 is needed for the earned income credit'
			},
			{
				key: `dependent_${n}_status`,
				prompt: `${label}: full-time student or permanently and totally disabled?`,
				type: 'choice',
				dependsOn,
				options: [
					{ value: 'none', label: 'Neither' },
					{ value: 'student', label: 'Full-time student (under 24)' },
					{ value: 'disabled', label: 'Permanently and totally disabled' }
				]
			}
		];
	});
}

export const usPersonalBase: TaxModule = {
	id: 'us-personal-base',
	name: 'US Personal - Base',
	description: 'Schedule A, B, D basics for personal tax filing',
	group: 'us-federal',
	categories: [
		// Schedule A - Itemized Deductions
		{ name: 'Medical Expenses', scheduleRef: 'Schedule A Line 1', description: 'Medical and dental expenses' },
		{ name: 'State & Local Taxes', scheduleRef: 'Schedule A Line 5a', description: 'State and local income or sales taxes' },
		{ name: 'Real Estate Taxes', scheduleRef: 'Schedule A Line 5b', description: 'Property taxes' },
		{ name: 'Mortgage Interest', scheduleRef: 'Schedule A Line 8a', description: 'Home mortgage interest' },
		{ name: 'Charitable Donations - Cash', scheduleRef: 'Schedule A Line 11', description: 'Cash contributions to charity' },
		{ name: 'Charitable Donations - Non-Cash', scheduleRef: 'Schedule A Line 12', description: 'Non-cash contributions to charity' },
		// Schedule B - Interest and Dividends
		{ name: 'Interest Income', scheduleRef: 'Schedule B Line 1', description: 'Interest from banks, bonds, etc.' },
		{ name: 'Dividend Income - Qualified', scheduleRef: 'Schedule B Line 5', description: 'Qualified dividends' },
		{ name: 'Dividend Income - Ordinary', scheduleRef: 'Schedule B Line 6', description: 'Ordinary dividends' },
		// Schedule D - Capital Gains
		{ name: 'Capital Gains - Short Term', scheduleRef: 'Schedule D Line 1', description: 'Short-term capital gains (held < 1 year)' },
		{ name: 'Capital Gains - Long Term', scheduleRef: 'Schedule D Line 8', description: 'Long-term capital gains (held >= 1 year)' },
		{ name: 'Capital Gain Distributions', scheduleRef: 'Schedule D Line 13', description: 'Capital gain distributions from mutual funds and ETFs (1099-DIV box 2a)' },
		// Non-deductible
		{ name: 'Not Deductible', scheduleRef: 'N/A', description: 'Personal expenses - not tax deductible' },
		{ name: 'Tax Exempt', scheduleRef: 'N/A', description: 'Tax-exempt income (municipal bonds, etc.)' },
	],
	questions: [
		{
			key: 'filing_status',
			prompt: 'Filing status',
			type: 'choice',
			options: [
				{ value: 'single', label: 'Single' },
				{ value: 'mfj', label: 'Married filing jointly' },
				{ value: 'mfs', label: 'Married filing separately' },
				{ value: 'hoh', label: 'Head of household' },
				{ value: 'qss', label: 'Qualifying surviving spouse' }
			]
		},
		{ key: 'dependents', prompt: 'Number of dependents claimed', type: 'number' },
		{
			key: 'qualifying_children',
			prompt: 'Of those, children under 17 who qualify for the child tax credit',
			type: 'number',
			description: 'Each qualifying child gets the child tax credit; other dependents get the credit for other dependents'
		},
		...dependentQuestions(),
		{
			key: 'age_65_or_blind',
			prompt: 'Boxes to check on Form 1040 line 12d (you or your spouse 65 or older, or blind)',
			type: 'number',
			carryForward: true,
			description: 'Each box adds to the standard deduction: 0 to 4'
		},
		{
			key: 'extension_filed',
			prompt: 'Was a federal extension (Form 4868) filed?',
			type: 'boolean'
		},
		{
			key: 'extension_payment',
			prompt: 'Amount paid with the federal extension',
			type: 'amount',
			dependsOn: { key: 'extension_filed', value: true }
		},
		{
			key: 'federal_estimated_payments',
			prompt: 'Federal estimated tax payments made for this year (total)',
			type: 'amount',
			description: 'Include payments made from accounts not tracked in this book'
		},
		{
			key: 'w2_wages',
			prompt: 'Did you or your spouse receive W-2 wages?',
			type: 'boolean'
		},
		{
			key: 'marketplace_coverage',
			prompt: 'Was health insurance bought through a state or federal marketplace?',
			type: 'boolean',
			description: 'Marketplace plans issue Form 1095-A, and any advance premium credit must be reconciled on Form 8962'
		},
		{
			key: 'owned_property_use',
			prompt: 'How is any real estate you own used?',
			type: 'choice',
			options: [
				{ value: 'none', label: 'No real estate owned' },
				{ value: 'primary', label: 'Primary residence' },
				{ value: 'second_home', label: 'Second home (not rented)' },
				{ value: 'rental', label: 'Rented to others (Schedule E)' }
			]
		},
		{ key: 'taxpayer_first_name', prompt: 'Your first name and middle initial (as on the return)', type: 'text', carryForward: true },
		{ key: 'taxpayer_last_name', prompt: 'Your last name', type: 'text', carryForward: true },
		{ key: 'taxpayer_ssn', prompt: 'Your social security number', type: 'text', carryForward: true },
		{ key: 'taxpayer_occupation', prompt: 'Your occupation', type: 'text', carryForward: true },
		{ key: 'spouse_first_name', prompt: 'Spouse’s first name and middle initial', type: 'text', carryForward: true, description: 'Joint and separate returns both name the spouse' },
		{ key: 'spouse_last_name', prompt: 'Spouse’s last name', type: 'text', carryForward: true },
		{ key: 'spouse_ssn', prompt: 'Spouse’s social security number', type: 'text', carryForward: true },
		{ key: 'spouse_occupation', prompt: 'Spouse’s occupation', type: 'text', carryForward: true },
		{ key: 'address_street', prompt: 'Home address (number and street)', type: 'text', carryForward: true },
		{ key: 'address_apt', prompt: 'Apartment number', type: 'text', carryForward: true },
		{ key: 'address_city', prompt: 'City, town, or post office', type: 'text', carryForward: true },
		{ key: 'address_state', prompt: 'State', type: 'text', carryForward: true },
		{ key: 'address_zip', prompt: 'ZIP code', type: 'text', carryForward: true },
		{
			key: 'roth_basis',
			prompt: 'Total Roth IRA contributions to date (basis)',
			type: 'amount',
			carryForward: true,
			description: 'Needed on Form 8606 for any Roth withdrawal before age 59½'
		},
		// Carryovers from last year's return, as positive amounts. The draft
		// return reports next year's figures with the fact:set lines to record them.
		{
			key: 'capital_loss_carryover_short',
			prompt: 'Short-term capital loss carried over from last year',
			type: 'amount',
			description: 'From last year’s Capital Loss Carryover Worksheet (Schedule D instructions); goes on Schedule D line 6. Enter as a positive amount'
		},
		{
			key: 'capital_loss_carryover_long',
			prompt: 'Long-term capital loss carried over from last year',
			type: 'amount',
			description: 'From the same worksheet; goes on Schedule D line 14. Enter as a positive amount'
		},
		{
			key: 'qbi_loss_carryforward',
			prompt: 'Qualified business loss carried forward from last year',
			type: 'amount',
			description: 'Last year’s Form 8995 line 16 (or Form 8995-A line 40); goes on Form 8995 line 3. Enter as a positive amount, or 0 if last year had no Form 8995'
		},
		{
			key: 'nol_carryforward',
			prompt: 'Net operating loss carried forward from prior years',
			type: 'amount',
			description: 'The NOL deduction on Schedule 1 line 8a. Enter as a positive amount'
		}
	],
	expectedDocuments: [
		{ formType: 'W-2', whenFact: { key: 'w2_wages', value: true }, reason: 'W-2 wages reported' },
		{
			formType: '1095-A',
			whenFact: { key: 'marketplace_coverage', value: true },
			reason: 'Marketplace health coverage'
		}
	]
};
