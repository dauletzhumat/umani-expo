import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import type { BudgetEnvelope } from '../allocation/income';
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
import { checkEntry } from './invariants';
import { applyEntry, checkReconciliation, emptyLedger, userAccount, type LedgerState } from './state';
import type { BudgetContext, EntryDraft } from './types';

const ENVELOPES: BudgetEnvelope<string>[] = [
  { id: 'needs', kind: 'needs', allocationBps: 5_000, sortOrder: 0 },
  { id: 'wants', kind: 'wants', allocationBps: 3_000, sortOrder: 1 },
  { id: 'savings', kind: 'savings', allocationBps: 2_000, sortOrder: 2 },
  { id: 'unallocated', kind: 'unallocated', allocationBps: 0, sortOrder: 99 },
];
const BUDGET: BudgetContext<string> = { baseCurrency: 'KZT', envelopes: ENVELOPES };
const ACCOUNTS: { id: string; currency: CurrencyCode; inBudget: boolean }[] = [
  { id: 'cash', currency: 'KZT', inBudget: true },
  { id: 'usd', currency: 'USD', inBudget: true },
  { id: 'eur', currency: 'EUR', inBudget: false },
  { id: 'broker', currency: 'KZT', inBudget: false },
];
const ENVELOPE_IDS = ENVELOPES.map((e) => e.id);

function fresh(): LedgerState<string, string> {
  return emptyLedger('KZT', ACCOUNTS, ENVELOPE_IDS);
}

describe('LedgerState', () => {
  it('applies entries to balances, book values and envelopes', () => {
    let state = fresh();
    const income = buildIncome(userAccount(state, 'cash'), money(1_000n, 'KZT'), BUDGET, { mode: 'auto' });
    if (!income.ok) throw new Error(income.error);
    state = applyEntry(state, income.value);

    expect(state.accounts.get('cash')).toEqual({ currency: 'KZT', inBudget: true, balance: 1_000n, bookValue: 1_000n });
    expect(state.envelopes.get('needs')).toBe(500n);
    expect(state.envelopes.get('unallocated')).toBe(0n);
    expect(checkReconciliation(state)).toEqual({ ok: true, value: undefined });
  });

  it('does not mutate the previous state', () => {
    const before = fresh();
    const opening = buildOpeningBalance(userAccount(before, 'cash'), money(5n, 'KZT'), BUDGET);
    if (!opening.ok) throw new Error(opening.error);
    applyEntry(before, opening.value);
    expect(before.accounts.get('cash')?.balance).toBe(0n);
  });

  it('throws on unknown accounts or envelopes (programmer error)', () => {
    const state = fresh();
    const ghostAccount: EntryDraft<string, string> = {
      kind: 'income',
      lines: [{ account: { type: 'user', accountId: 'ghost' }, amount: money(1n, 'KZT'), base: money(1n, 'KZT') }],
      envelopeLines: [],
    };
    expect(() => applyEntry(state, ghostAccount)).toThrow();
    const ghostEnvelope: EntryDraft<string, string> = {
      kind: 'allocation',
      lines: [],
      envelopeLines: [{ envelopeId: 'ghost', amount: money(1n, 'KZT') }],
    };
    expect(() => applyEntry(state, ghostEnvelope)).toThrow();
    expect(() => userAccount(state, 'ghost')).toThrow();
  });

  it('detects R1 violations and base-account drift', () => {
    const state = fresh();
    const drifted: LedgerState<string, string> = {
      ...state,
      envelopes: new Map([...state.envelopes, ['needs', 1n]]),
    };
    expect(checkReconciliation(drifted)).toEqual({
      ok: false,
      error: { code: 'r1_violation', envelopes: 1n, bookValue: 0n },
    });

    const baseDrift: LedgerState<string, string> = {
      ...state,
      accounts: new Map([...state.accounts, ['cash', { currency: 'KZT', inBudget: true, balance: 5n, bookValue: 4n }]]),
    };
    expect(checkReconciliation(baseDrift)).toEqual({ ok: false, error: { code: 'base_account_drift', accountId: 'cash' } });
  });
});

/* ---------- property: R1 and L1 hold after any sequence of operations ---------- */

const rateArb = fc
  .tuple(fc.integer({ min: 1, max: 1_000 }), fc.integer({ min: 0, max: 99 }))
  .map(([whole, cents]) => `${whole}.${cents.toString().padStart(2, '0')}`);
const amountArb = fc.bigInt({ min: 1n, max: 1_000_000_000n });
const accountArb = fc.constantFrom(...ACCOUNTS.map((a) => a.id));
const envelopeArb = fc.constantFrom(...ENVELOPE_IDS);

type Op =
  | { t: 'opening'; account: string; amount: bigint; negative: boolean; rate: string }
  | { t: 'income'; account: string; amount: bigint; rate: string; manualShare: number | null }
  | { t: 'expense'; account: string; amount: bigint; envelope: string; rate: string }
  | { t: 'transfer'; from: string; to: string; amount: bigint; received: bigint; envelope: string | null; rate: string }
  | { t: 'realloc'; from: string; to: string; amount: bigint }
  | { t: 'adjust'; account: string; target: bigint; rate: string }
  | { t: 'reval'; account: string; rate: string }
  | { t: 'reverse'; index: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('opening' as const), account: accountArb, amount: amountArb, negative: fc.boolean(), rate: rateArb }),
  fc.record({
    t: fc.constant('income' as const),
    account: accountArb,
    amount: amountArb,
    rate: rateArb,
    manualShare: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  }),
  fc.record({ t: fc.constant('expense' as const), account: accountArb, amount: amountArb, envelope: envelopeArb, rate: rateArb }),
  fc.record({
    t: fc.constant('transfer' as const),
    from: accountArb,
    to: accountArb,
    amount: amountArb,
    received: amountArb,
    envelope: fc.option(envelopeArb, { nil: null }),
    rate: rateArb,
  }),
  fc.record({ t: fc.constant('realloc' as const), from: envelopeArb, to: envelopeArb, amount: amountArb }),
  fc.record({ t: fc.constant('adjust' as const), account: accountArb, target: fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), rate: rateArb }),
  fc.record({ t: fc.constant('reval' as const), account: accountArb, rate: rateArb }),
  fc.record({ t: fc.constant('reverse' as const), index: fc.nat() }),
);

function build(state: LedgerState<string, string>, op: Op, history: EntryDraft<string, string>[]) {
  const currencyOf = (id: string) => (state.accounts.get(id) as { currency: CurrencyCode }).currency;
  switch (op.t) {
    case 'opening': {
      const amount = money(op.negative ? -op.amount : op.amount, currencyOf(op.account));
      return buildOpeningBalance(userAccount(state, op.account), amount, BUDGET, op.rate);
    }
    case 'income': {
      const account = userAccount(state, op.account);
      const amount = money(op.amount, currencyOf(op.account));
      if (op.manualShare === null) return buildIncome(account, amount, BUDGET, { mode: 'auto' }, op.rate);
      // manual split is defined on the base amount; assign a share of a lower bound to Savings
      const part = (op.amount * BigInt(op.manualShare)) / 100n / 1_000n;
      return buildIncome(
        account,
        amount,
        BUDGET,
        { mode: 'manual', parts: [{ envelopeId: 'savings', amount: money(part, 'KZT') }] },
        op.rate,
      );
    }
    case 'expense':
      return buildExpense(
        userAccount(state, op.account),
        money(op.amount, currencyOf(op.account)),
        op.envelope,
        BUDGET,
        op.rate,
      );
    case 'transfer': {
      const sameCurrency = currencyOf(op.from) === currencyOf(op.to);
      return buildTransfer(
        userAccount(state, op.from),
        userAccount(state, op.to),
        money(op.amount, currencyOf(op.from)),
        money(sameCurrency ? op.amount : op.received, currencyOf(op.to)),
        BUDGET,
        { envelopeId: op.envelope ?? undefined, rate: op.rate },
      );
    }
    case 'realloc':
      return buildReallocation(op.from, op.to, money(op.amount, 'KZT'), BUDGET);
    case 'adjust':
      return buildAdjustment(userAccount(state, op.account), money(op.target, currencyOf(op.account)), BUDGET, op.rate);
    case 'reval':
      return buildRevaluation(userAccount(state, op.account), op.rate, BUDGET);
    case 'reverse': {
      if (history.length === 0) return { ok: false as const, error: 'nothing_to_reverse' };
      return buildReversal(history[op.index % history.length] as EntryDraft<string, string>);
    }
  }
}

describe('reconciliation property (DATABASE.md R1, L1)', () => {
  it('holds after any sequence of valid operations', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        let state = fresh();
        const history: EntryDraft<string, string>[] = [];
        for (const op of ops) {
          const result = build(state, op, history);
          if (!result.ok) continue; // invalid operations are rejected, state unchanged
          expect(checkEntry(result.value, 'KZT')).toEqual({ ok: true, value: undefined });
          state = applyEntry(state, result.value);
          history.push(result.value);
          expect(checkReconciliation(state)).toEqual({ ok: true, value: undefined });
        }
      }),
      { numRuns: 300 },
    );
  });
});
