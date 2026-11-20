import type { CurrencyCode } from '../money/currency';
import { CurrencyMismatchError, money, type Money } from '../money/money';
import { divideHalfEven } from '../money/rounding';

/**
 * Savings goals and the deposit planner (PRD BUD-7, DEP-1). Pure functions over Money; dates are
 * ISO calendar days ("YYYY-MM-DD") in the user's time zone.
 */

/** "2026-11-20" → months since year 0, so month arithmetic is plain subtraction. */
function monthIndex(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Not an ISO date: ${isoDate}`);
  }
  return year * 12 + (month - 1);
}

export type MonthIncome = Readonly<{ month: string; income: Money }>;

/** How many full months before the current one the average looks at. */
export const INCOME_WINDOW_MONTHS = 3;

/**
 * Average monthly income for the planner's expected contributions (DEP-1): the last full months
 * (the current month isn't finished), counting a month without income as zero, but never months
 * before the user's first income. With no full month yet, the current month stands in. Null when
 * there is no income at all. Rounded half to even.
 */
export function averageMonthlyIncome(
  months: readonly MonthIncome[],
  today: string,
  base: CurrencyCode,
  window: number = INCOME_WINDOW_MONTHS,
): Money | null {
  const current = monthIndex(today);
  const byMonth = new Map<number, bigint>();
  for (const row of months) {
    if (row.income.currency !== base) throw new CurrencyMismatchError(row.income.currency, base);
    const index = monthIndex(row.month);
    byMonth.set(index, (byMonth.get(index) ?? 0n) + row.income.amountMinor);
  }
  const withIncome = [...byMonth.entries()].filter(([, amount]) => amount > 0n).map(([index]) => index);
  if (withIncome.length === 0) return null;
  const first = Math.min(...withIncome);

  const end = current - 1;
  const start = Math.max(current - window, first);
  if (start > end) {
    const now = byMonth.get(current) ?? 0n;
    return now > 0n ? money(now, base) : null;
  }
  let sum = 0n;
  for (let index = start; index <= end; index += 1) sum += byMonth.get(index) ?? 0n;
  return money(divideHalfEven(sum, BigInt(end - start + 1)), base);
}

/** Months to save in, counting the current month and the target month; 0 once the date has passed. */
export function monthsLeft(today: string, targetDate: string): number {
  if (targetDate < today) return 0;
  return monthIndex(targetDate) - monthIndex(today) + 1;
}

export type MonthlyNeed =
  | Readonly<{ kind: 'reached' }>
  | Readonly<{ kind: 'no_date'; missing: Money }>
  | Readonly<{ kind: 'overdue'; missing: Money }>
  | Readonly<{ kind: 'monthly'; amount: Money; months: number }>;

/**
 * What to put aside each month to reach the goal by its date (BUD-7). Rounded up, so paying it
 * every month always reaches the target. An overspent (negative) balance counts as nothing saved.
 */
export function requiredMonthly(target: Money, balance: Money, today: string, targetDate: string | null): MonthlyNeed {
  if (target.currency !== balance.currency) throw new CurrencyMismatchError(target.currency, balance.currency);
  const saved = balance.amountMinor > 0n ? balance.amountMinor : 0n;
  const missing = target.amountMinor - saved;
  if (missing <= 0n) return { kind: 'reached' };
  const missingMoney = money(missing, target.currency);
  if (targetDate === null) return { kind: 'no_date', missing: missingMoney };
  const months = monthsLeft(today, targetDate);
  if (months === 0) return { kind: 'overdue', missing: missingMoney };
  const count = BigInt(months);
  const amount = (missing + count - 1n) / count; // ceiling: missing > 0
  return { kind: 'monthly', amount: money(amount, target.currency), months };
}

export type GoalProgress = Readonly<{ permille: number; reached: boolean }>;

/** Progress toward a goal, 0…1000 permille (for the bar only, never used as money). */
export function goalProgress(target: Money, balance: Money): GoalProgress {
  if (target.currency !== balance.currency) throw new CurrencyMismatchError(target.currency, balance.currency);
  if (target.amountMinor <= 0n) throw new RangeError('A goal target must be positive');
  const saved = balance.amountMinor > 0n ? balance.amountMinor : 0n;
  const reached = saved >= target.amountMinor;
  return { permille: reached ? 1000 : Number((saved * 1000n) / target.amountMinor), reached };
}
