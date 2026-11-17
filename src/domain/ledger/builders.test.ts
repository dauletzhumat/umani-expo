import { describe, expect, it } from '@jest/globals';

import type { BudgetEnvelope } from '../allocation/income';
import { bookPosition } from '../fx/book-value';
import type { CurrencyCode } from '../money/currency';
import { money } from '../money/money';
import {
  buildAdjustment,
  buildExpense,
  buildIncome,
  buildOpeningBalance,
  buildReallocation,
  buildRevaluation,
  buildReversal,
  buildTransfer,
} from './builders';
import type { BudgetContext, UserAccount } from './types';

const kzt = (n: bigint) => money(n, 'KZT');
const usd = (n: bigint) => money(n, 'USD');
const user = (accountId: string) => ({ type: 'user' as const, accountId });
const sys = (role: string) => ({ type: 'system' as const, role });

const envelopes: BudgetEnvelope<string>[] = [
  { id: 'needs', kind: 'needs', allocationBps: 5_000, sortOrder: 0 },
  { id: 'wants', kind: 'wants', allocationBps: 3_000, sortOrder: 1 },
  { id: 'savings', kind: 'savings', allocationBps: 2_000, sortOrder: 2 },
  { id: 'unallocated', kind: 'unallocated', allocationBps: 0, sortOrder: 99 },
];
const budget: BudgetContext<string> = { baseCurrency: 'KZT', envelopes };

function account(
  id: string,
  currency: CurrencyCode,
  inBudget: boolean,
  balance = 0n,
  book: bigint = currency === 'KZT' ? balance : 0n,
): UserAccount<string> {
  return { id, inBudget, position: bookPosition(money(balance, currency), kzt(book)) };
}

const cash = account('cash', 'KZT', true);
const kaspi = account('kaspi', 'KZT', true, 50_000_000n);
const usdCard = account('usd', 'USD', true, 100_000n, 50_500_000n);
const broker = account('broker', 'KZT', false);

describe('DATABASE.md §4 examples', () => {
  it('opening balance 200 000 ₸ in cash → Unallocated', () => {
    expect(buildOpeningBalance(cash, kzt(20_000_000n), budget)).toEqual({
      ok: true,
      value: {
        kind: 'opening_balance',
        lines: [
          { account: user('cash'), amount: kzt(20_000_000n), base: kzt(20_000_000n) },
          { account: sys('opening_balance'), amount: kzt(-20_000_000n), base: null },
        ],
        envelopeLines: [{ envelopeId: 'unallocated', amount: kzt(20_000_000n) }],
      },
    });
  });

  it('income 500 000 ₸, 50/30/20', () => {
    expect(buildIncome(kaspi, kzt(50_000_000n), budget, { mode: 'auto' })).toEqual({
      ok: true,
      value: {
        kind: 'income',
        lines: [
          { account: user('kaspi'), amount: kzt(50_000_000n), base: kzt(50_000_000n) },
          { account: sys('income'), amount: kzt(-50_000_000n), base: null },
        ],
        envelopeLines: [
          { envelopeId: 'needs', amount: kzt(25_000_000n) },
          { envelopeId: 'wants', amount: kzt(15_000_000n) },
          { envelopeId: 'savings', amount: kzt(10_000_000n) },
        ],
      },
    });
  });

  it('income 1 000 USD at a confirmed rate of 505.00', () => {
    const result = buildIncome(account('usd', 'USD', true), usd(100_000n), budget, { mode: 'auto' }, '505.00');
    expect(result.ok && result.value.lines).toEqual([
      { account: user('usd'), amount: usd(100_000n), base: kzt(50_500_000n) },
      { account: sys('income'), amount: usd(-100_000n), base: null },
    ]);
    expect(result.ok && result.value.envelopeLines.reduce((a, l) => a + l.amount.amountMinor, 0n)).toBe(50_500_000n);
  });

  it('expense 12 500 ₸ from cash, Needs', () => {
    expect(buildExpense(account('cash', 'KZT', true, 5_000_000n), kzt(1_250_000n), 'needs', budget)).toEqual({
      ok: true,
      value: {
        kind: 'expense',
        lines: [
          { account: user('cash'), amount: kzt(-1_250_000n), base: kzt(-1_250_000n) },
          { account: sys('expense'), amount: kzt(1_250_000n), base: null },
        ],
        envelopeLines: [{ envelopeId: 'needs', amount: kzt(-1_250_000n) }],
      },
    });
  });

  it('expense 40 USD at moving average', () => {
    const result = buildExpense(usdCard, usd(4_000n), 'wants', budget);
    expect(result.ok && result.value.lines[0]).toEqual({ account: user('usd'), amount: usd(-4_000n), base: kzt(-2_020_000n) });
    expect(result.ok && result.value.envelopeLines).toEqual([{ envelopeId: 'wants', amount: kzt(-2_020_000n) }]);
  });

  it('cross-currency transfer 100 USD → 50 300 ₸ books the FX result to Unallocated', () => {
    expect(buildTransfer(usdCard, kaspi, usd(10_000n), kzt(5_030_000n), budget)).toEqual({
      ok: true,
      value: {
        kind: 'transfer',
        lines: [
          { account: user('usd'), amount: usd(-10_000n), base: kzt(-5_050_000n) },
          { account: user('kaspi'), amount: kzt(5_030_000n), base: kzt(5_030_000n) },
          { account: sys('fx_clearing'), amount: usd(10_000n), base: null },
          { account: sys('fx_clearing'), amount: kzt(-5_030_000n), base: null },
        ],
        envelopeLines: [{ envelopeId: 'unallocated', amount: kzt(-20_000n) }],
      },
    });
  });

  it('transfer budgeted → unbudgeted takes money out of an envelope (default Unallocated)', () => {
    const result = buildTransfer(kaspi, broker, kzt(10_000_000n), kzt(10_000_000n), budget);
    expect(result.ok && result.value.envelopeLines).toEqual([{ envelopeId: 'unallocated', amount: kzt(-10_000_000n) }]);
    expect(result.ok && result.value.lines).toHaveLength(2);
  });

  it('reversal negates every line and keeps nothing else', () => {
    const expense = buildExpense(account('cash', 'KZT', true, 5_000_000n), kzt(1_250_000n), 'needs', budget);
    if (!expense.ok) throw new Error(expense.error);
    expect(buildReversal(expense.value)).toEqual({
      ok: true,
      value: {
        kind: 'reversal',
        lines: [
          { account: user('cash'), amount: kzt(1_250_000n), base: kzt(1_250_000n) },
          { account: sys('expense'), amount: kzt(-1_250_000n), base: null },
        ],
        envelopeLines: [{ envelopeId: 'needs', amount: kzt(1_250_000n) }],
      },
    });
  });
});

describe('opening balance', () => {
  it('allows a negative opening balance (e.g. a credit card)', () => {
    const result = buildOpeningBalance(cash, kzt(-300n), budget);
    expect(result.ok && result.value.envelopeLines).toEqual([{ envelopeId: 'unallocated', amount: kzt(-300n) }]);
  });

  it('values foreign currency at the confirmed rate; outside the budget there are no envelope lines', () => {
    const result = buildOpeningBalance(account('eur', 'EUR', false), money(1_000n, 'EUR'), budget, '550');
    expect(result.ok && result.value.lines[0]?.base).toEqual(kzt(550_000n));
    expect(result.ok && result.value.envelopeLines).toEqual([]);
  });

  it('validates', () => {
    expect(buildOpeningBalance(cash, kzt(0n), budget)).toEqual({ ok: false, error: 'zero_amount' });
    expect(buildOpeningBalance(cash, usd(5n), budget)).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(buildOpeningBalance(account('usd', 'USD', true), usd(5n), budget)).toEqual({ ok: false, error: 'rate_required' });
    const noUnallocated = { ...budget, envelopes: envelopes.slice(0, 3) };
    expect(buildOpeningBalance(cash, kzt(5n), noUnallocated)).toEqual({ ok: false, error: 'missing_unallocated' });
  });

  it('drops an envelope line whose base rounds to zero', () => {
    const result = buildOpeningBalance(account('usd', 'USD', true), usd(1n), budget, '0.001');
    expect(result.ok && result.value.envelopeLines).toEqual([]);
  });
});

describe('income', () => {
  it('manual split with remainder to Unallocated', () => {
    const result = buildIncome(kaspi, kzt(1_000n), budget, {
      mode: 'manual',
      parts: [{ envelopeId: 'savings', amount: kzt(600n) }],
    });
    expect(result.ok && result.value.envelopeLines).toEqual([
      { envelopeId: 'savings', amount: kzt(600n) },
      { envelopeId: 'unallocated', amount: kzt(400n) },
    ]);
  });

  it('into an unbudgeted account creates no envelope lines', () => {
    const result = buildIncome(broker, kzt(1_000n), budget, { mode: 'auto' });
    expect(result.ok && result.value.envelopeLines).toEqual([]);
  });

  it('validates', () => {
    expect(buildIncome(kaspi, kzt(0n), budget, { mode: 'auto' })).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(buildIncome(kaspi, usd(10n), budget, { mode: 'auto' })).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(
      buildIncome(kaspi, kzt(10n), budget, { mode: 'manual', parts: [{ envelopeId: 'needs', amount: kzt(11n) }] }),
    ).toEqual({ ok: false, error: 'exceeds_total' });
    expect(buildIncome(kaspi, kzt(10n), { ...budget, envelopes: [] }, { mode: 'auto' })).toEqual({
      ok: false,
      error: 'invalid_budget',
    });
  });
});

describe('expense', () => {
  it('needs an existing envelope for a budgeted account', () => {
    expect(buildExpense(kaspi, kzt(1n), null, budget)).toEqual({ ok: false, error: 'envelope_required' });
    expect(buildExpense(kaspi, kzt(1n), 'ghost', budget)).toEqual({ ok: false, error: 'unknown_envelope' });
  });

  it('from an unbudgeted account touches no envelope', () => {
    const result = buildExpense(account('broker', 'KZT', false, 500n), kzt(100n), null, budget);
    expect(result.ok && result.value.envelopeLines).toEqual([]);
  });

  it('validates', () => {
    expect(buildExpense(kaspi, kzt(0n), 'needs', budget)).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(buildExpense(kaspi, usd(1n), 'needs', budget)).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(buildExpense(usdCard, usd(200_000n), 'needs', budget)).toEqual({ ok: false, error: 'rate_required' });
  });
});

describe('transfer', () => {
  it('same currency: two lines, no envelope effect', () => {
    expect(buildTransfer(kaspi, cash, kzt(700n), kzt(700n), budget)).toEqual({
      ok: true,
      value: {
        kind: 'transfer',
        lines: [
          { account: user('kaspi'), amount: kzt(-700n), base: kzt(-700n) },
          { account: user('cash'), amount: kzt(700n), base: kzt(700n) },
        ],
        envelopeLines: [],
      },
    });
  });

  it('unbudgeted → budgeted adds to the chosen envelope', () => {
    const result = buildTransfer(account('broker', 'KZT', false, 1_000n), cash, kzt(400n), kzt(400n), budget, {
      envelopeId: 'savings',
    });
    expect(result.ok && result.value.envelopeLines).toEqual([{ envelopeId: 'savings', amount: kzt(400n) }]);
  });

  it('unbudgeted → unbudgeted: no envelope lines', () => {
    const otherBroker = account('broker2', 'KZT', false);
    const result = buildTransfer(account('broker', 'KZT', false, 1_000n), otherBroker, kzt(400n), kzt(400n), budget);
    expect(result.ok && result.value.envelopeLines).toEqual([]);
  });

  it('validates', () => {
    expect(buildTransfer(kaspi, kaspi, kzt(1n), kzt(1n), budget)).toEqual({ ok: false, error: 'same_account' });
    expect(buildTransfer(kaspi, cash, kzt(1n), usd(1n), budget)).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(buildTransfer(kaspi, cash, kzt(1n), kzt(2n), budget)).toEqual({ ok: false, error: 'amount_mismatch' });
    expect(buildTransfer(kaspi, broker, kzt(1n), kzt(1n), budget, { envelopeId: 'ghost' })).toEqual({
      ok: false,
      error: 'unknown_envelope',
    });
  });
});

describe('reallocation', () => {
  it('moves budget between envelopes', () => {
    expect(buildReallocation('wants', 'savings', kzt(500n), budget)).toEqual({
      ok: true,
      value: {
        kind: 'allocation',
        lines: [],
        envelopeLines: [
          { envelopeId: 'wants', amount: kzt(-500n) },
          { envelopeId: 'savings', amount: kzt(500n) },
        ],
      },
    });
  });

  it('validates', () => {
    expect(buildReallocation('wants', 'wants', kzt(1n), budget)).toEqual({ ok: false, error: 'same_envelope' });
    expect(buildReallocation('wants', 'ghost', kzt(1n), budget)).toEqual({ ok: false, error: 'unknown_envelope' });
    expect(buildReallocation('wants', 'savings', kzt(0n), budget)).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(buildReallocation('wants', 'savings', usd(1n), budget)).toEqual({ ok: false, error: 'currency_mismatch' });
  });
});

describe('adjustment', () => {
  it('up and down, difference to Unallocated', () => {
    const up = buildAdjustment(kaspi, kzt(50_000_100n), budget);
    expect(up.ok && up.value.lines).toEqual([
      { account: user('kaspi'), amount: kzt(100n), base: kzt(100n) },
      { account: sys('adjustment'), amount: kzt(-100n), base: null },
    ]);
    expect(up.ok && up.value.envelopeLines).toEqual([{ envelopeId: 'unallocated', amount: kzt(100n) }]);

    const down = buildAdjustment(usdCard, usd(96_000n), budget);
    expect(down.ok && down.value.lines[0]).toEqual({ account: user('usd'), amount: usd(-4_000n), base: kzt(-2_020_000n) });
  });

  it('validates', () => {
    expect(buildAdjustment(kaspi, kzt(50_000_000n), budget)).toEqual({ ok: false, error: 'no_change' });
    expect(buildAdjustment(kaspi, usd(1n), budget)).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(buildAdjustment(usdCard, usd(100_001n), budget)).toEqual({ ok: false, error: 'rate_required' });
    const noUnallocated = { ...budget, envelopes: envelopes.slice(0, 3) };
    expect(buildAdjustment(kaspi, kzt(1n), noUnallocated)).toEqual({ ok: false, error: 'missing_unallocated' });
    const deepOverdraft = account('cash', 'KZT', true, -1_000_000_000_000_000n);
    expect(buildAdjustment(deepOverdraft, kzt(1_000_000_000_000_000n), budget)).toEqual({
      ok: false,
      error: 'out_of_range',
    });
  });
});

describe('revaluation', () => {
  it('zero-amount line carrying the book-value delta, mirrored on Unallocated', () => {
    expect(buildRevaluation(usdCard, '510', budget)).toEqual({
      ok: true,
      value: {
        kind: 'fx_revaluation',
        lines: [{ account: user('usd'), amount: usd(0n), base: kzt(500_000n) }],
        envelopeLines: [{ envelopeId: 'unallocated', amount: kzt(500_000n) }],
      },
    });
  });

  it('validates', () => {
    expect(buildRevaluation(usdCard, '505', budget)).toEqual({ ok: false, error: 'no_change' });
    expect(buildRevaluation(kaspi, '1', budget)).toEqual({ ok: false, error: 'not_foreign_currency' });
    const noUnallocated = { ...budget, envelopes: envelopes.slice(0, 3) };
    expect(buildRevaluation(usdCard, '510', noUnallocated)).toEqual({ ok: false, error: 'missing_unallocated' });
    expect(buildRevaluation(usdCard, '510', { ...budget, baseCurrency: 'EUR' })).toEqual({
      ok: false,
      error: 'base_currency_mismatch',
    });
  });

  it('outside the budget only the book value changes', () => {
    const eur = account('eur', 'EUR', false, 1_000n, 550_000n);
    const result = buildRevaluation(eur, '560', budget);
    expect(result.ok && result.value.envelopeLines).toEqual([]);
    expect(result.ok && result.value.lines[0]?.base).toEqual(kzt(10_000n));
  });
});

describe('reversal', () => {
  it('cannot reverse a reversal', () => {
    const income = buildIncome(kaspi, kzt(10n), budget, { mode: 'auto' });
    if (!income.ok) throw new Error(income.error);
    const reversal = buildReversal(income.value);
    if (!reversal.ok) throw new Error(reversal.error);
    expect(buildReversal(reversal.value)).toEqual({ ok: false, error: 'cannot_reverse_reversal' });
  });
});

describe('account / budget mismatch', () => {
  it('rejects accounts valued in another base currency', () => {
    const foreignBook = { id: 'x', inBudget: true, position: bookPosition(usd(10n), money(10n, 'EUR')) };
    expect(buildIncome(foreignBook, usd(1n), budget, { mode: 'auto' }, '1')).toEqual({
      ok: false,
      error: 'base_currency_mismatch',
    });
  });
});
