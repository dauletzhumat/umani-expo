import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { BPS_TOTAL } from '../money/allocate';
import { MAX_ABS_MINOR, money } from '../money/money';
import { autoAllocateIncome, manualAllocateIncome, type BudgetEnvelope } from './income';

const kzt = (n: bigint) => money(n, 'KZT');

/** 50/30/20 plus the system Unallocated envelope, deliberately out of order. */
const envelopes: readonly BudgetEnvelope<string>[] = [
  { id: 'savings', kind: 'savings', allocationBps: 2_000, sortOrder: 2 },
  { id: 'unallocated', kind: 'unallocated', allocationBps: 0, sortOrder: 99 },
  { id: 'needs', kind: 'needs', allocationBps: 5_000, sortOrder: 0 },
  { id: 'wants', kind: 'wants', allocationBps: 3_000, sortOrder: 1 },
];

describe('autoAllocateIncome (PRD INC-2)', () => {
  it('splits by method in sort order and never touches Unallocated', () => {
    expect(autoAllocateIncome(kzt(50_000_000n), envelopes)).toEqual({
      ok: true,
      value: [
        { envelopeId: 'needs', amount: kzt(25_000_000n) },
        { envelopeId: 'wants', amount: kzt(15_000_000n) },
        { envelopeId: 'savings', amount: kzt(10_000_000n) },
      ],
    });
  });

  it('uses sort order for the rounding tie-break', () => {
    const halves: BudgetEnvelope<string>[] = [
      { id: 'b', kind: 'custom', allocationBps: 5_000, sortOrder: 1 },
      { id: 'a', kind: 'custom', allocationBps: 5_000, sortOrder: 0 },
    ];
    expect(autoAllocateIncome(kzt(1n), halves)).toEqual({ ok: true, value: [{ envelopeId: 'a', amount: kzt(1n) }] });
  });

  it('drops zero parts (envelope lines must be non-zero)', () => {
    const result = autoAllocateIncome(kzt(1n), envelopes);
    expect(result).toEqual({ ok: true, value: [{ envelopeId: 'needs', amount: kzt(1n) }] });
  });

  it('rejects non-positive income', () => {
    expect(autoAllocateIncome(kzt(0n), envelopes)).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(autoAllocateIncome(kzt(-5n), envelopes)).toEqual({ ok: false, error: 'non_positive_amount' });
  });

  it('rejects a budget whose weights do not total 100%', () => {
    const broken: BudgetEnvelope<string>[] = [{ id: 'x', kind: 'custom', allocationBps: 9_000, sortOrder: 0 }];
    expect(autoAllocateIncome(kzt(100n), broken)).toEqual({ ok: false, error: 'invalid_budget' });
    expect(autoAllocateIncome(kzt(100n), [envelopes[1] as BudgetEnvelope<string>])).toEqual({
      ok: false,
      error: 'invalid_budget',
    });
  });

  it('property: lines are positive and sum exactly to the income', () => {
    const budgetArb = fc
      .array(fc.integer({ min: 1, max: BPS_TOTAL - 1 }), { maxLength: 11 })
      .map((cuts) => {
        const points = [0, ...[...new Set(cuts)].sort((a, b) => a - b), BPS_TOTAL];
        return points.slice(1).map<BudgetEnvelope<string>>((p, i) => ({
          id: `e${i}`,
          kind: 'custom',
          allocationBps: p - (points[i] as number),
          sortOrder: i,
        }));
      });
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: MAX_ABS_MINOR }), budgetArb, (amount, budget) => {
        const result = autoAllocateIncome(kzt(amount), budget);
        if (!result.ok) throw new Error(result.error);
        expect(result.value.every((l) => l.amount.amountMinor > 0n)).toBe(true);
        expect(result.value.reduce((a, l) => a + l.amount.amountMinor, 0n)).toBe(amount);
      }),
    );
  });
});

describe('manualAllocateIncome (PRD INC-3, DATABASE R6)', () => {
  it('keeps the user split and sends the remainder to Unallocated', () => {
    expect(
      manualAllocateIncome(kzt(100_000n), envelopes, [
        { envelopeId: 'needs', amount: kzt(60_000n) },
        { envelopeId: 'savings', amount: kzt(30_000n) },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { envelopeId: 'needs', amount: kzt(60_000n) },
        { envelopeId: 'savings', amount: kzt(30_000n) },
        { envelopeId: 'unallocated', amount: kzt(10_000n) },
      ],
    });
  });

  it('adds no Unallocated line when fully assigned, and drops zero parts', () => {
    expect(
      manualAllocateIncome(kzt(100n), envelopes, [
        { envelopeId: 'needs', amount: kzt(100n) },
        { envelopeId: 'wants', amount: kzt(0n) },
      ]),
    ).toEqual({ ok: true, value: [{ envelopeId: 'needs', amount: kzt(100n) }] });
  });

  it('allows putting everything in Unallocated', () => {
    expect(manualAllocateIncome(kzt(100n), envelopes, [])).toEqual({
      ok: true,
      value: [{ envelopeId: 'unallocated', amount: kzt(100n) }],
    });
  });

  it('validates the split', () => {
    const income = kzt(100n);
    expect(manualAllocateIncome(kzt(0n), envelopes, [])).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(manualAllocateIncome(income, envelopes, [{ envelopeId: 'needs', amount: money(10n, 'USD') }])).toEqual({
      ok: false,
      error: 'currency_mismatch',
    });
    expect(manualAllocateIncome(income, envelopes, [{ envelopeId: 'ghost', amount: kzt(10n) }])).toEqual({
      ok: false,
      error: 'unknown_envelope',
    });
    expect(manualAllocateIncome(income, envelopes, [{ envelopeId: 'unallocated', amount: kzt(10n) }])).toEqual({
      ok: false,
      error: 'unknown_envelope',
    });
    expect(
      manualAllocateIncome(income, envelopes, [
        { envelopeId: 'needs', amount: kzt(10n) },
        { envelopeId: 'needs', amount: kzt(10n) },
      ]),
    ).toEqual({ ok: false, error: 'duplicate_envelope' });
    expect(manualAllocateIncome(income, envelopes, [{ envelopeId: 'needs', amount: kzt(-1n) }])).toEqual({
      ok: false,
      error: 'negative_part',
    });
    expect(
      manualAllocateIncome(income, envelopes, [
        { envelopeId: 'needs', amount: kzt(60n) },
        { envelopeId: 'wants', amount: kzt(41n) },
      ]),
    ).toEqual({ ok: false, error: 'exceeds_total' });
  });

  it('needs an Unallocated envelope only when there is a remainder', () => {
    const noUnallocated = envelopes.filter((e) => e.kind !== 'unallocated');
    expect(manualAllocateIncome(kzt(100n), noUnallocated, [{ envelopeId: 'needs', amount: kzt(100n) }]).ok).toBe(true);
    expect(manualAllocateIncome(kzt(100n), noUnallocated, [{ envelopeId: 'needs', amount: kzt(50n) }])).toEqual({
      ok: false,
      error: 'missing_unallocated',
    });
  });

  it('property: lines always sum exactly to the income', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 3, maxLength: 3 }),
        (amount, raw) => {
          const ids = ['needs', 'wants', 'savings'];
          const parts = raw.map((r) => (amount === 0n ? 0n : r % (amount / 3n + 1n)));
          const manual = parts.map((p, i) => ({ envelopeId: ids[i] as string, amount: kzt(p) }));
          const result = manualAllocateIncome(kzt(amount), envelopes, manual);
          if (!result.ok) throw new Error(result.error);
          expect(result.value.reduce((a, l) => a + l.amount.amountMinor, 0n)).toBe(amount);
          expect(result.value.every((l) => l.amount.amountMinor > 0n)).toBe(true);
        },
      ),
    );
  });
});
