import { CLI_HELP } from '../cli-help';

export interface TaxCategory {
	id: string;
	name: string;
	scheduleRef: string | null;
	description: string | null;
}

export interface SampleTransaction {
	date: string;
	description: string;
	amount: string;
}

export interface SuggestTaxCategoryContext {
	bookId: string;
	accountId: string;
	accountType: string;
	accountPath: string;
	taxCategories: TaxCategory[];
	sampleTransactions: SampleTransaction[];
	transactionCount: number;
}

function formatTaxCategory(tc: TaxCategory): string {
	let str = `  - ${tc.id}\t${tc.name}`;
	if (tc.scheduleRef) str += `\t(${tc.scheduleRef})`;
	if (tc.description) str += `\t${tc.description}`;
	return str;
}

function formatTransaction(tx: SampleTransaction): string {
	return `  ${tx.date}\t${tx.amount}\t${tx.description}`;
}

export function generateSuggestTaxCategoryPrompt(ctx: SuggestTaxCategoryContext): string {
	const taxCategoriesSection = ctx.taxCategories.length > 0
		? ctx.taxCategories.map(formatTaxCategory).join('\n')
		: '  (no tax categories configured)';

	const transactionsSection = ctx.sampleTransactions.length > 0
		? ctx.sampleTransactions.map(formatTransaction).join('\n')
		: '  (no transactions)';

	const showingNote = ctx.transactionCount > ctx.sampleTransactions.length
		? ` (showing ${ctx.sampleTransactions.length} of ${ctx.transactionCount})`
		: '';

	const mp = `bin/mp --book ${ctx.bookId}`;

	return `MODE: UI-Embedded Agent

TASK: Recommend a tax category for account "${ctx.accountPath}"

BOOK ID: ${ctx.bookId}

ACCOUNT INFO:
- ID: ${ctx.accountId}
- Type: ${ctx.accountType}
- Path: ${ctx.accountPath}
- Transaction count: ${ctx.transactionCount}

SAMPLE TRANSACTIONS${showingNote}:
Date\tAmount\tDescription
${transactionsSection}

AVAILABLE TAX CATEGORIES:
ID\tName\tSchedule Reference\tDescription
${taxCategoriesSection}

YOUR TASK:

1. **Analyze the account and its transactions**
   Based on the account name "${ctx.accountPath}" and the sample transactions above, determine what type of expense or income this represents.

2. **Recommend a tax category**
   Match the account to the most appropriate tax category from the list above.
   Consider:
   - The IRS schedule reference (Schedule C for business, Schedule A for itemized deductions, etc.)
   - Whether this is a personal or business expense
   - The nature of the transactions (what they're being spent on)

3. **Present your recommendation**
   - State which tax category you recommend and why
   - Explain how the transactions support this categorization
   - If "Not Deductible" is most appropriate (personal expenses, non-deductible items), explain why

4. **Provide the command to apply it**
   Give the exact command to set the tax category:
   \`${mp} account:update ${ctx.accountId} --tax-category <category-id>\`

   Then STOP and wait for the user to approve before executing the command.

IMPORTANT: Do NOT execute the account:update command until the user explicitly approves. Present your recommendation first and wait for confirmation.

CLI REFERENCE:
${CLI_HELP}
`;
}
