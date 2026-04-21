import { CLI_HELP } from '../cli-help';

export interface UncategorizedTransaction {
	id: string;
	date: string;
	description: string;
	amount: string;
	creditAccount: string;
	debitAccount: string;
}

export interface AuditRule {
	id: string;
	pattern: string;
	field: string;
	isRegex: boolean;
	priority: number;
	amountMin: number | null;
	amountMax: number | null;
	amountExact: number | null;
}

export interface TransactionGroup {
	description: string;
	count: number;
	totalAmount: number;
	minAmount: number;
	maxAmount: number;
	dateRange: { earliest: string; latest: string };
}

export interface AuditContext {
	bookId: string;
	accountId: string;
	accountType: string;
	accountPath: string;
	transactionCount: number;
	rules: AuditRule[];
	transactionSummary: TransactionGroup[];
	uncategorizedTransactions: UncategorizedTransaction[];
}

function formatCurrency(amount: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2
	}).format(amount);
}

function formatRule(rule: AuditRule): string {
	let str = `  - "${rule.pattern}"`;
	if (rule.isRegex) str += ' (regex)';
	if (rule.field !== 'description') str += ` [field: ${rule.field}]`;
	if (rule.amountExact !== null) {
		str += ` amount=${formatCurrency(rule.amountExact)}`;
	} else if (rule.amountMin !== null || rule.amountMax !== null) {
		const min = rule.amountMin !== null ? formatCurrency(rule.amountMin) : '0';
		const max = rule.amountMax !== null ? formatCurrency(rule.amountMax) : '∞';
		str += ` amount=${min}–${max}`;
	}
	return str;
}

function formatTransactionGroup(group: TransactionGroup): string {
	const amountRange = group.minAmount === group.maxAmount
		? formatCurrency(group.minAmount)
		: `${formatCurrency(group.minAmount)}–${formatCurrency(group.maxAmount)}`;
	return `  - "${group.description}" (${group.count}x, ${amountRange}, ${group.dateRange.earliest} to ${group.dateRange.latest})`;
}

function formatUncategorizedTransaction(tx: UncategorizedTransaction): string {
	return `${tx.id}\t${tx.date}\t${tx.description}\t${tx.amount}\t${tx.creditAccount}\t${tx.debitAccount}`;
}

export function generateAuditPrompt(ctx: AuditContext): string {
	const rulesSection = ctx.rules.length > 0
		? ctx.rules.map(formatRule).join('\n')
		: '  (no rules configured)';

	const summarySection = ctx.transactionSummary.length > 0
		? ctx.transactionSummary.map(formatTransactionGroup).join('\n')
		: '  (no transactions)';

	const uncategorizedSection = ctx.uncategorizedTransactions.length > 0
		? ctx.uncategorizedTransactions.map(formatUncategorizedTransaction).join('\n')
		: '  (none)';

	const mp = `bin/mp --book ${ctx.bookId}`;

	return `MODE: UI-Embedded Agent

TASK: Audit account "${ctx.accountPath}"

BOOK ID: ${ctx.bookId}

ACCOUNT INFO:
- ID: ${ctx.accountId}
- Type: ${ctx.accountType}
- Path: ${ctx.accountPath}
- Transaction count: ${ctx.transactionCount}

CURRENT RULES (${ctx.rules.length}):
${rulesSection}

TRANSACTION SUMMARY (grouped by description, sorted by frequency):
${summarySection}

ALL UNCATEGORIZED TRANSACTIONS IN SYSTEM (${ctx.uncategorizedTransactions.length}):
These are ALL pending transactions across the entire system, not specific to this account.
Scan this list for any that might belong to "${ctx.accountPath}".
ID\tDate\tDescription\tAmount\tCredit\tDebit
${uncategorizedSection}

YOUR TASKS:

1. **Review the rules above**
   - Are any patterns too broad and might match unintended transactions?
   - Are there transaction patterns in the summary that aren't covered by rules?
   - Should any rules have amount constraints added?

2. **Check for miscategorized transactions**
   Based on the TRANSACTION SUMMARY above (transactions already in this account), flag any descriptions that seem out of place for a "${ctx.accountPath}" account.
   If you spot potential issues, use \`${mp} tx:list --account ${ctx.accountId} --search "PATTERN"\` to investigate.

3. **Find uncategorized transactions that might belong here**
   Scan the ALL UNCATEGORIZED TRANSACTIONS list for any that should be categorized to "${ctx.accountPath}".
   Most will NOT belong here - only look for ones that match this account's purpose (${ctx.accountType}: ${ctx.accountPath}).

4. **Present your plan and WAIT for approval**
   Summarize your findings and proposed actions:
   - Any potentially miscategorized transactions (with IDs if you looked them up)
   - Rule improvements (with specific \`${mp} rule:create\` or \`${mp} rule:update\` commands you would run)
   - Uncategorized transactions that should be categorized here (with the \`${mp} tx:categorize\` commands you would run)

   Then STOP and wait for the user to approve before executing any commands that modify data.
   You may run read-only commands (tx:list, tx:get, rule:list, etc.) without approval.

IMPORTANT: Do NOT execute any database mutations (tx:categorize, rule:create, rule:update, rule:delete, tx:update, etc.) until the user explicitly approves your plan. Always present your recommendations first and wait for confirmation.

EFFICIENCY: When listing transactions that could return many results (100+), use \`--condensed\` to get a compact summary view instead of full details. For example: \`${mp} tx:list --account ${ctx.accountId} --condensed\` or \`${mp} tx:uncategorized --condensed\`.

CLI REFERENCE:
${CLI_HELP}
`;
}
