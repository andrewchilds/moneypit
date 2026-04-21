import { db } from '../db';
import { Prisma } from '@prisma/client';
import { logOperation, serialize, diff } from './operationLog';

export async function listBalanceRecords(accountId: string) {
	return db.balanceRecord.findMany({
		where: { accountId },
		orderBy: [{ date: 'desc' }, { balance: 'desc' }]
	});
}

export async function getBalanceRecord(id: string) {
	return db.balanceRecord.findUnique({
		where: { id }
	});
}

export async function createBalanceRecord(
	accountId: string,
	date: Date,
	balance: number
) {
	// Verify account exists and is ASSET or LIABILITY
	const account = await db.account.findUnique({
		where: { id: accountId }
	});

	if (!account) {
		throw new Error('Account not found');
	}

	if (account.type !== 'ASSET' && account.type !== 'LIABILITY') {
		throw new Error('Balance records can only be added to Asset or Liability accounts');
	}

	// Check if record exists for logging purposes
	const existing = await db.balanceRecord.findUnique({
		where: { accountId_date: { accountId, date } }
	});

	const result = await db.balanceRecord.upsert({
		where: {
			accountId_date: { accountId, date }
		},
		update: { balance },
		create: { accountId, date, balance }
	});

	if (existing) {
		const { before: beforeDiff, after: afterDiff } = diff(serialize(existing), serialize(result));
		if (Object.keys(beforeDiff).length > 0) {
			await logOperation(account.bookId, 'UPDATE', `Updated balance record for ${account.path}`, [
				{
					entityType: 'BalanceRecord',
					entityId: result.id,
					before: beforeDiff,
					after: afterDiff
				}
			]);
		}
	} else {
		await logOperation(account.bookId, 'CREATE', `Created balance record for ${account.path}`, [
			{
				entityType: 'BalanceRecord',
				entityId: result.id,
				before: null,
				after: serialize(result)
			}
		]);
	}

	return result;
}

export async function deleteBalanceRecord(id: string) {
	const before = await db.balanceRecord.findUniqueOrThrow({
		where: { id },
		include: { account: { select: { bookId: true, path: true } } }
	});

	await db.balanceRecord.delete({
		where: { id }
	});

	await logOperation(before.account.bookId, 'DELETE', `Deleted balance record for ${before.account.path}`, [
		{
			entityType: 'BalanceRecord',
			entityId: id,
			before: serialize(before),
			after: null
		}
	]);
}

export async function getCalculatedBalanceAsOf(accountId: string, date: Date): Promise<number> {
	const result = await db.$queryRaw<{ balance: number }[]>`
		SELECT
			COALESCE(a."openingBalance", 0) + COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "debitAccountId" = ${accountId} AND date <= ${date} AND "merged_into_id" IS NULL),
				0
			) - COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "creditAccountId" = ${accountId} AND date <= ${date} AND "merged_into_id" IS NULL),
				0
			) as balance
		FROM "Account" a
		WHERE a.id = ${accountId}
	`;

	return Number(result[0]?.balance ?? 0);
}

export async function getCurrentBalance(accountId: string): Promise<number> {
	const result = await db.$queryRaw<{ balance: number }[]>`
		SELECT
			COALESCE(a."openingBalance", 0) + COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "debitAccountId" = ${accountId} AND "merged_into_id" IS NULL),
				0
			) - COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "creditAccountId" = ${accountId} AND "merged_into_id" IS NULL),
				0
			) as balance
		FROM "Account" a
		WHERE a.id = ${accountId}
	`;

	return Number(result[0]?.balance ?? 0);
}

/**
 * Get net activity (debits - credits) for an account within a date range.
 * Unlike getCurrentBalance, this doesn't include opening balance - just the activity total.
 */
export async function getBalanceForDateRange(
	accountId: string,
	from: Date,
	to: Date
): Promise<number> {
	const result = await db.$queryRaw<{ balance: number }[]>`
		SELECT
			COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "debitAccountId" = ${accountId} AND date >= ${from} AND date <= ${to} AND "merged_into_id" IS NULL),
				0
			) - COALESCE(
				(SELECT SUM(amount) FROM "Transaction" WHERE "creditAccountId" = ${accountId} AND date >= ${from} AND date <= ${to} AND "merged_into_id" IS NULL),
				0
			) as balance
	`;

	return Number(result[0]?.balance ?? 0);
}

export interface MonthlyActivityRow {
	month: string; // YYYY-MM format
	debits: number;
	credits: number;
	endBalance: number;
}

export async function getMonthlyActivity(
	accountId: string,
	dateRange?: { from?: Date; to?: Date }
): Promise<MonthlyActivityRow[]> {
	// Build date filter conditions
	const dateConditions: Prisma.Sql[] = [];
	if (dateRange?.from) {
		dateConditions.push(Prisma.sql`AND date >= ${dateRange.from}`);
	}
	if (dateRange?.to) {
		dateConditions.push(Prisma.sql`AND date <= ${dateRange.to}`);
	}
	const dateFilter = dateConditions.length > 0
		? Prisma.sql`${Prisma.join(dateConditions, ' ')}`
		: Prisma.empty;

	// Get monthly debits and credits for this account
	const monthlyData = await db.$queryRaw<{ month: string; debits: number; credits: number }[]>`
		SELECT
			TO_CHAR(date, 'YYYY-MM') as month,
			COALESCE(SUM(CASE WHEN "debitAccountId" = ${accountId} THEN amount ELSE 0 END), 0) as debits,
			COALESCE(SUM(CASE WHEN "creditAccountId" = ${accountId} THEN amount ELSE 0 END), 0) as credits
		FROM "Transaction"
		WHERE ("debitAccountId" = ${accountId} OR "creditAccountId" = ${accountId})
			AND "merged_into_id" IS NULL
			${dateFilter}
		GROUP BY TO_CHAR(date, 'YYYY-MM')
		ORDER BY month ASC
	`;

	if (monthlyData.length === 0) {
		return [];
	}

	// Get starting balance - either account opening balance or calculated balance before date range
	let startingBalance: number;
	if (dateRange?.from) {
		// Calculate balance as of the day before the date range starts
		const dayBefore = new Date(dateRange.from);
		dayBefore.setDate(dayBefore.getDate() - 1);
		startingBalance = await getCalculatedBalanceAsOf(accountId, dayBefore);
	} else {
		const account = await db.account.findUnique({
			where: { id: accountId },
			select: { openingBalance: true }
		});
		startingBalance = Number(account?.openingBalance ?? 0);
	}

	// Build a map of months with activity
	const activityMap = new Map<string, { debits: number; credits: number }>();
	for (const row of monthlyData) {
		activityMap.set(row.month, {
			debits: Number(row.debits),
			credits: Number(row.credits)
		});
	}

	// Generate all months between first and last
	const firstMonth = monthlyData[0].month;
	const lastMonth = monthlyData[monthlyData.length - 1].month;
	const allMonths: string[] = [];
	const [startYear, startMonthNum] = firstMonth.split('-').map(Number);
	const [endYear, endMonthNum] = lastMonth.split('-').map(Number);

	let year = startYear;
	let month = startMonthNum;
	while (year < endYear || (year === endYear && month <= endMonthNum)) {
		allMonths.push(`${year}-${String(month).padStart(2, '0')}`);
		month++;
		if (month > 12) {
			month = 1;
			year++;
		}
	}

	// Calculate running end balance for each month (including empty ones)
	let runningBalance = startingBalance;
	return allMonths.map((monthKey) => {
		const activity = activityMap.get(monthKey) || { debits: 0, credits: 0 };
		runningBalance += activity.debits - activity.credits;
		return {
			month: monthKey,
			debits: activity.debits,
			credits: activity.credits,
			endBalance: runningBalance
		};
	});
}
