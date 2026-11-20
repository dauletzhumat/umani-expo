import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { money } from '../money/money';
import { averageMonthlyIncome, goalProgress, monthsLeft, requiredMonthly } from './savings';

const kzt = (minor: bigint) => money(minor, 'KZT');

describe('averageMonthlyIncome', () => {
  const months = [
    { month: '2026-08-01', income: kzt(30_000_000n) },
    { month: '2026-09-01', income: kzt(40_000_000n) },
    { month: '2026-10-01', income: kzt(50_000_000n) },
    { month: '2026-11-01', income: kzt(99_000_000n) }, // the current month is not finished
  ];

  it('averages the last three full months, leaving the current month out', () => {
    expect(averageMonthlyIncome(months, '2026-11-20', 'KZT')).toEqual(kzt(40_000_000n));
  });

  it('counts a month without income inside the history as zero', () => {
    const gap = [
      { month: '2026-08-01', income: kzt(30_000_000n) },
      { month: '2026-10-01', income: kzt(50_000_000n) },
    ];
    // Aug 300 000, Sep nothing, Oct 500 000 → 800 000 / 3
    expect(averageMonthlyIncome(gap, '2026-11-20', 'KZT')).toEqual(kzt(26_666_667n));
  });

  it('does not count months before the first income (a new user is not penalised)', () => {
    expect(averageMonthlyIncome([{ month: '2026-10-01', income: kzt(50_000_000n) }], '2026-11-05', 'KZT')).toEqual(
      kzt(50_000_000n),
    );
  });

  it('falls back to the current month when there is no full month yet, else null', () => {
    expect(averageMonthlyIncome([{ month: '2026-11-01', income: kzt(1_000n) }], '2026-11-20', 'KZT')).toEqual(kzt(1_000n));
    expect(averageMonthlyIncome([], '2026-11-20', 'KZT')).toBeNull();
    expect(averageMonthlyIncome([{ month: '2026-11-01', income: kzt(0n) }], '2026-11-20', 'KZT')).toBeNull();
  });

  it('ignores months older than the window and crosses the year boundary', () => {
    const rows = [
      { month: '2025-01-01', income: kzt(999n) },
      { month: '2025-11-01', income: kzt(10n) },
      { month: '2025-12-01', income: kzt(20n) },
    ];
    // window Oct–Dec 2025; history starts before it, so Oct counts as zero: 30 / 3
    expect(averageMonthlyIncome(rows, '2026-01-10', 'KZT')).toEqual(kzt(10n));
  });

  it('rejects income in another currency (programmer error)', () => {
    expect(() => averageMonthlyIncome([{ month: '2026-10-01', income: money(1n, 'USD') }], '2026-11-20', 'KZT')).toThrow();
    expect(() => requiredMonthly(kzt(1n), money(1n, 'USD'), '2026-11-20', null)).toThrow();
  });

  it('a current month with nothing yet and no full month gives null', () => {
    // first income is in a future month relative to the window (clock skew); nothing this month
    expect(averageMonthlyIncome([{ month: '2026-12-01', income: kzt(5n) }], '2026-11-20', 'KZT')).toBeNull();
  });

  it('rounds half to even', () => {
    const rows = [
      { month: '2026-09-01', income: kzt(1n) },
      { month: '2026-10-01', income: kzt(0n) },
    ];
    // 1 / 2 = 0.5 → 0 (half to even)
    expect(averageMonthlyIncome(rows, '2026-11-01', 'KZT')).toEqual(kzt(0n));
  });
});

describe('monthsLeft', () => {
  it('counts the current month and the target month', () => {
    expect(monthsLeft('2026-11-20', '2026-11-30')).toBe(1);
    expect(monthsLeft('2026-11-20', '2026-12-01')).toBe(2);
    expect(monthsLeft('2026-11-20', '2027-11-20')).toBe(13);
  });

  it('rejects a malformed date (programmer error)', () => {
    expect(() => monthsLeft('2026-11-20', '2026-13-01')).toThrow(RangeError);
  });

  it('a past date leaves no months', () => {
    expect(monthsLeft('2026-11-20', '2026-10-31')).toBe(0);
    expect(monthsLeft('2026-11-20', '2026-11-19')).toBe(0);
  });
});

describe('requiredMonthly', () => {
  it('splits what is missing over the months left, rounding up so the goal is reached', () => {
    // 1 000 000 missing over 3 months → 333 333.34
    expect(requiredMonthly(kzt(100_000_000n), kzt(0n), '2026-11-20', '2027-01-15')).toEqual({
      kind: 'monthly',
      amount: kzt(33_333_334n),
      months: 3,
    });
  });

  it('a reached goal needs nothing', () => {
    expect(requiredMonthly(kzt(100n), kzt(150n), '2026-11-20', '2027-01-15')).toEqual({ kind: 'reached' });
  });

  it('without a date there is no monthly amount', () => {
    expect(requiredMonthly(kzt(100n), kzt(10n), '2026-11-20', null)).toEqual({ kind: 'no_date', missing: kzt(90n) });
  });

  it('a date in the past is overdue', () => {
    expect(requiredMonthly(kzt(100n), kzt(10n), '2026-11-20', '2026-10-01')).toEqual({
      kind: 'overdue',
      missing: kzt(90n),
    });
  });

  it('a negative (overspent) balance counts as nothing saved', () => {
    expect(requiredMonthly(kzt(100n), kzt(-50n), '2026-11-20', '2026-11-30')).toEqual({
      kind: 'monthly',
      amount: kzt(100n),
      months: 1,
    });
  });

  it('paying the monthly amount every month always reaches the goal (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 14n }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 14n }),
        fc.integer({ min: 0, max: 120 }),
        (target, balance, offset) => {
          const index = 10 + offset; // months after January 2026, starting at November
          const date = `${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-28`; // after "today" even in November
          const result = requiredMonthly(kzt(target), kzt(balance), '2026-11-20', date);
          const saved = balance > 0n ? balance : 0n;
          if (saved >= target) return result.kind === 'reached';
          if (result.kind !== 'monthly') return false;
          const months = BigInt(result.months);
          const missing = target - saved;
          // reaches the goal, and is the smallest monthly amount that does
          return result.amount.amountMinor * months >= missing && (result.amount.amountMinor - 1n) * months < missing;
        },
      ),
    );
  });
});

describe('goalProgress', () => {
  it('is 0…1000 permille, capped, with a reached flag', () => {
    expect(goalProgress(kzt(1_000n), kzt(250n))).toEqual({ permille: 250, reached: false });
    expect(goalProgress(kzt(1_000n), kzt(1_000n))).toEqual({ permille: 1000, reached: true });
    expect(goalProgress(kzt(1_000n), kzt(5_000n))).toEqual({ permille: 1000, reached: true });
    expect(goalProgress(kzt(1_000n), kzt(-5n))).toEqual({ permille: 0, reached: false });
    expect(goalProgress(kzt(3n), kzt(1n))).toEqual({ permille: 333, reached: false });
  });

  it('rejects mixed currencies and a non-positive target (programmer errors)', () => {
    expect(() => goalProgress(kzt(1n), money(1n, 'USD'))).toThrow();
    expect(() => goalProgress(kzt(0n), kzt(1n))).toThrow();
  });
});
