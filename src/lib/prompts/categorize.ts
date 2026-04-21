import { CLI_HELP } from "../cli-help";

export interface CategorizeRule {
	id: string;
	pattern: string;
	field: string;
	isRegex: boolean;
	accountType: string;
	accountPath: string;
	amountMin: number | null;
	amountMax: number | null;
	amountExact: number | null;
}

export interface CategorizeAccount {
	id: string;
	type: string;
	path: string;
}

export interface UncategorizedTransaction {
	id: string;
	date: string;
	description: string;
	amount: string;
	creditAccount: string;
	debitAccount: string;
}

export interface CategorizeContext {
	bookId: string;
	accounts: CategorizeAccount[];
	rules: CategorizeRule[];
	uncategorizedTransactions: UncategorizedTransaction[];
	totalUncategorized: number;
}

function formatCurrency(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2
	}).format(amount);
}

function formatRule(rule: CategorizeRule): string {
	const flags = [];
	if (rule.isRegex) flags.push("regex");
	if (rule.field !== "description") flags.push(`field:${rule.field}`);
	if (rule.amountExact !== null) {
		flags.push(`=${formatCurrency(rule.amountExact)}`);
	} else if (rule.amountMin !== null || rule.amountMax !== null) {
		const min = rule.amountMin !== null ? formatCurrency(rule.amountMin) : "0";
		const max = rule.amountMax !== null ? formatCurrency(rule.amountMax) : "∞";
		flags.push(`${min}–${max}`);
	}
	const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
	return `  "${rule.pattern}"${flagStr} → ${rule.accountType}:${rule.accountPath}`;
}

function formatAccount(account: CategorizeAccount): string {
	return `  ${account.id}\t${account.type}\t${account.path}`;
}

function formatUncategorizedTransaction(tx: UncategorizedTransaction): string {
	return `${tx.id}\t${tx.date}\t${tx.description}\t${tx.amount}\t${tx.creditAccount}\t${tx.debitAccount}`;
}

export function generateCategorizePrompt(ctx: CategorizeContext): string {
	const rulesSection = ctx.rules.length > 0 ? ctx.rules.map(formatRule).join("\n") : "  (no rules configured)";

	const accountsByType: Record<string, CategorizeAccount[]> = {};
	for (const account of ctx.accounts) {
		if (!accountsByType[account.type]) {
			accountsByType[account.type] = [];
		}
		accountsByType[account.type].push(account);
	}

	const accountsSection = Object.entries(accountsByType)
		.map(([type, accts]) => `${type}:\n${accts.map(formatAccount).join("\n")}`)
		.join("\n\n");

	const uncategorizedSection =
		ctx.uncategorizedTransactions.length > 0
			? ctx.uncategorizedTransactions.map(formatUncategorizedTransaction).join("\n")
			: "  (none)";

	const showingNote =
		ctx.totalUncategorized > ctx.uncategorizedTransactions.length
			? ` (showing first ${ctx.uncategorizedTransactions.length} of ${ctx.totalUncategorized})`
			: "";

	const mp = `bin/mp --book ${ctx.bookId}`;

	return `MODE: UI-Embedded Agent

TASK: Categorize pending transactions by recommending rules

BOOK ID: ${ctx.bookId}

UNCATEGORIZED TRANSACTIONS${showingNote}:
ID\tDate\tDescription\tAmount\tCredit\tDebit
${uncategorizedSection}

EXISTING RULES (${ctx.rules.length}):
${rulesSection}

EXISTING ACCOUNTS:
${accountsSection}

YOUR TASKS:

1. **Analyze the uncategorized transactions**
   Look for patterns in the descriptions that could be captured by rules.
   Group similar transactions mentally and identify:
   - Recurring merchants/payees (e.g., "AMAZON", "SPOTIFY", "SHELL OIL")
   - Common patterns that appear across multiple transactions
   - Transactions that might need amount constraints (same merchant, different categories based on amount)

2. **Check existing rules for coverage**
   - Do any existing rules already match these transactions? If so, running \`${mp} rule:apply\` may categorize them.
   - Are there patterns in uncategorized transactions that SHOULD be matched by existing rules but aren't? (possible rule refinement)

3. **Recommend new rules**
   For transaction patterns not covered by existing rules:
   - Identify the target account from EXISTING ACCOUNTS above
   - If no suitable account exists, suggest creating one first
   - Prefer substring patterns over regex when possible (simpler, more reliable)
   - Consider amount constraints for merchants that span categories (e.g., "TARGET" could be groceries OR household goods)

4. **Present your recommendations and WAIT for approval**
   Summarize your findings:
   - Rules that should be applied immediately: \`${mp} rule:apply\` (if existing rules would match)
   - New rules to create (with specific \`${mp} rule:create\` commands)
   - New accounts needed (with specific \`${mp} account:create\` commands)
   - Any transactions that need manual categorization (unusual one-offs)

   Then STOP and wait for the user to approve before executing any commands that modify data.
   You may run read-only commands (tx:list, rule:list, account:list, etc.) without approval.

IMPORTANT: Do NOT execute any database mutations (rule:create, account:create, tx:categorize, etc.) until the user explicitly approves your plan. Always present your recommendations first and wait for confirmation.

TIPS:
- Pick the top 6-8 transaction/account categories to resolve first - you don't have to evaluate the entire list, especially if it's very long.
- Use \`${mp} rule:test "PATTERN"\` to preview which transactions a rule would match before creating it
- Prioritize rules that would categorize the most transactions
- For transfers between accounts, the credit account is the source, debit account is the destination

CLI REFERENCE:
${CLI_HELP}
`;
}
