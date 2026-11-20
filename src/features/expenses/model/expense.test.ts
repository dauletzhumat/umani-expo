import { describe, expect, it } from '@jest/globals';

import { money } from '@/domain/money/money';

import {
  accountForEdit,
  defaultEnvelopeFor,
  estimateBaseCost,
  projectedEnvelopeBalance,
  sortCategories,
  type Category,
  formatDay,
  monthStart,
  needsRate,
  rateFromInput,
  toExpenseError,
  toHistory,
  toLimitProgress,
  type ExpenseAccount,
} from './expense';

const usd = (balance: bigint, book: bigint): ExpenseAccount => ({
  id: 'usd',
  name: 'USD',
  currency: 'USD',
  includeInBudget: true,
  balance: money(balance, 'USD'),
  bookValue: money(book, 'KZT'),
});
const kzt: ExpenseAccount = {
  id: 'kzt',
  name: 'Cash',
  currency: 'KZT',
  includeInBudget: true,
  balance: money(10_000n, 'KZT'),
  bookValue: money(10_000n, 'KZT'),
};

describe('estimateBaseCost', () => {
  it('a base-currency expense costs the envelope its own amount, even beyond the balance', () => {
    expect(estimateBaseCost(kzt, money(25_000n, 'KZT'))).toEqual(money(25_000n, 'KZT'));
  });

  it('a foreign expense uses the moving average book value (half to even)', () => {
    // 100.00 USD booked at 47 500.00 KZT; 33.33 USD → 47 500 × 3 333 / 10 000 = 15 831.75
    expect(estimateBaseCost(usd(10_000n, 4_750_000n), money(3_333n, 'USD'))).toEqual(money(1_583_175n, 'KZT'));
  });

  it('spending the whole balance takes the whole book value', () => {
    expect(estimateBaseCost(usd(10_000n, 4_750_001n), money(10_000n, 'USD'))).toEqual(money(4_750_001n, 'KZT'));
  });

  it('an overdraft is unknown without a rate and valued at the rate with one', () => {
    const account = usd(1_000n, 475_000n);
    expect(estimateBaseCost(account, money(3_000n, 'USD'))).toBeNull();
    // 10.00 USD from the average (4 750.00) + 20.00 USD at 480 (9 600.00)
    expect(estimateBaseCost(account, money(3_000n, 'USD'), '480')).toEqual(money(1_435_000n, 'KZT'));
  });
});

describe('needsRate', () => {
  it('only a foreign expense above the positive balance needs a rate', () => {
    expect(needsRate(kzt, money(99_999n, 'KZT'), 'KZT')).toBe(false);
    expect(needsRate(usd(1_000n, 475_000n), money(1_000n, 'USD'), 'KZT')).toBe(false);
    expect(needsRate(usd(1_000n, 475_000n), money(1_001n, 'USD'), 'KZT')).toBe(true);
    expect(needsRate(usd(-500n, 0n), money(1n, 'USD'), 'KZT')).toBe(true);
    expect(needsRate(usd(1_000n, 475_000n), null, 'KZT')).toBe(false);
  });
});

describe('toLimitProgress', () => {
  const row = (limit: string, spent: string) => ({
    limit_id: '00000000-0000-4000-8000-000000000001',
    envelope_id: '00000000-0000-4000-8000-000000000002',
    category_id: null,
    limit_minor: limit,
    spent_minor: spent,
  });

  it('is on track below 80%, near from 80%, over above the limit', () => {
    expect(toLimitProgress(row('100000', '79999'), 'KZT')?.state).toBe('ok');
    expect(toLimitProgress(row('100000', '80000'), 'KZT')?.state).toBe('near');
    expect(toLimitProgress(row('100000', '100000'), 'KZT')?.state).toBe('near');
    expect(toLimitProgress(row('100000', '100001'), 'KZT')?.state).toBe('over');
  });

  it('caps the bar at 1000‰ and floors negative spending (refunds) at zero', () => {
    expect(toLimitProgress(row('100000', '250000'), 'KZT')?.permille).toBe(1000);
    expect(toLimitProgress(row('100000', '-5000'), 'KZT')?.permille).toBe(0);
    expect(toLimitProgress(row('300', '100'), 'KZT')?.permille).toBe(333);
  });

  it('keeps exact amounts beyond 2^53 and rejects malformed rows', () => {
    const exact = toLimitProgress(row('900000000000000', '800000000000001'), 'KZT');
    expect(exact?.spent.amountMinor).toBe(800_000_000_000_001n);
    expect(toLimitProgress(row('0', '0'), 'KZT')).toBeNull();
    expect(toLimitProgress(row('abc', '0'), 'KZT')).toBeNull();
  });
});

describe('toHistory', () => {
  const base = {
    entry_id: '00000000-0000-4000-8000-000000000010',
    kind: 'expense' as const,
    occurred_on: '2026-11-19',
    category_id: null,
    note: null,
    account_id: '00000000-0000-4000-8000-000000000011',
    currency: 'KZT',
    amount_minor: '-450050',
    envelope_id: '00000000-0000-4000-8000-000000000012',
  };

  it('maps rows with signed amounts in the account currency', () => {
    const [item] = toHistory([base]);
    expect(item?.amount).toEqual(money(-450_050n, 'KZT'));
    expect(item?.key).toBe(`${base.entry_id}:${base.account_id}`);
  });

  it('skips rows with an unknown currency or a bad amount', () => {
    expect(toHistory([{ ...base, currency: 'XXX' }, { ...base, amount_minor: '1.5' }])).toEqual([]);
  });
});

describe('helpers', () => {
  it('maps known RPC errors and falls back to failed', () => {
    expect(toExpenseError('envelope_required')).toBe('envelope_required');
    expect(toExpenseError('boom')).toBe('failed');
    expect(toExpenseError(undefined)).toBe('failed');
  });

  it('formats days and months', () => {
    expect(monthStart('2026-11-19')).toBe('2026-11-01');
    expect(formatDay('2026-11-19')).toBe('19.11.2026');
    expect(formatDay('bad')).toBe('bad');
  });

  it('accepts decimal rates with a comma or a dot only', () => {
    expect(rateFromInput(' 475,5 ')).toBe('475.5');
    expect(rateFromInput('0')).toBeNull();
    expect(rateFromInput('abc')).toBeNull();
  });
});

describe('editing', () => {
  it('puts the original amount back on the account (the server reverses it first)', () => {
    const edited = accountForEdit(kzt, { accountId: 'kzt', amount: money(-4_000n, 'KZT') });
    expect(edited.bookKnown).toBe(true);
    expect(edited.account.balance).toEqual(money(14_000n, 'KZT'));
    expect(edited.account.bookValue).toEqual(money(14_000n, 'KZT'));
  });

  it('a foreign edit gets its balance back, so editing up to the original needs no rate', () => {
    const account = usd(1_000n, 475_000n);
    const original = { accountId: 'usd', amount: money(-2_000n, 'USD') };
    expect(needsRate(account, money(2_000n, 'USD'), 'KZT')).toBe(true);
    const edited = accountForEdit(account, original);
    expect(edited.bookKnown).toBe(false);
    expect(needsRate(edited.account, money(2_000n, 'USD'), 'KZT')).toBe(false);
  });

  it('leaves other accounts as they are', () => {
    expect(accountForEdit(kzt, { accountId: 'usd', amount: money(-1n, 'USD') }).account).toBe(kzt);
    expect(accountForEdit(kzt, undefined).account).toBe(kzt);
  });

  it('projects the envelope balance with the refund of the reversed original', () => {
    const envelope = { balance: money(10_000n, 'KZT') };
    expect(projectedEnvelopeBalance(envelope, money(25_000n, 'KZT'), null)).toEqual(money(-15_000n, 'KZT'));
    expect(projectedEnvelopeBalance(envelope, money(25_000n, 'KZT'), money(20_000n, 'KZT'))).toEqual(money(5_000n, 'KZT'));
    expect(projectedEnvelopeBalance(envelope, null, null)).toBeNull();
  });
});

describe('categories', () => {
  const cat = (id: string, nameKey: string | null, name: string | null = null, defaultEnvelopeId: string | null = null): Category => ({
    id,
    kind: 'expense',
    name,
    nameKey,
    defaultEnvelopeId,
  });
  const envelopes = [
    { id: 'n', kind: 'needs' },
    { id: 'w', kind: 'wants' },
  ];

  it('sorts defaults in template order, then custom ones as created', () => {
    const sorted = sortCategories([
      cat('a', null, 'Coffee'),
      cat('b', 'category.otherExpense'),
      cat('c', 'category.groceries'),
      cat('d', null, 'Books'),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('prefers the category default, then a preset suggestion, else none', () => {
    expect(defaultEnvelopeFor(cat('x', 'category.groceries', null, 'w'), envelopes)).toBe('w');
    expect(defaultEnvelopeFor(cat('x', 'category.groceries'), envelopes)).toBe('n');
    expect(defaultEnvelopeFor(cat('x', 'category.restaurants'), envelopes)).toBe('w');
    expect(defaultEnvelopeFor(cat('x', 'category.otherExpense'), envelopes)).toBeNull();
    expect(defaultEnvelopeFor(cat('x', null, 'Coffee'), envelopes)).toBeNull();
    // a default pointing at an archived envelope falls back to the suggestion
    expect(defaultEnvelopeFor(cat('x', 'category.groceries', null, 'gone'), envelopes)).toBe('n');
    expect(defaultEnvelopeFor(undefined, envelopes)).toBeNull();
  });
});
