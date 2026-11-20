import { describe, expect, it } from '@jest/globals';

import { money } from '@/domain/money/money';

import { addMonths, buildDepositPlan, horizonDate, toSavingsError, type PlanAccount, type PlanEnvelope } from './savings';

const kzt = (minor: bigint) => money(minor, 'KZT');
const envelope = (id: string, kind: PlanEnvelope['kind'], bps: number, sortOrder: number): PlanEnvelope => ({
  id,
  name: null,
  nameKey: `envelope.${kind}`,
  kind,
  allocationBps: bps,
  sortOrder,
  balance: kzt(0n),
});
const ENVELOPES = [
  envelope('needs', 'needs', 5000, 0),
  envelope('wants', 'wants', 3000, 1),
  envelope('savings', 'savings', 2000, 2),
  envelope('unalloc', 'unallocated', 0, 1000),
];
const account = (id: string, kind: string, linkedEnvelopeId: string | null = null): PlanAccount => ({
  id,
  name: id,
  kind,
  linkedEnvelopeId,
  balance: kzt(0n),
});

describe('buildDepositPlan', () => {
  it('recommends one deposit per savings envelope with its exact share of the average month', () => {
    const plan = buildDepositPlan(ENVELOPES, [account('card', 'card')], kzt(100_000_001n));
    expect(plan.savings).toHaveLength(1);
    // 1 000 000.01 × 20 % with largest remainder (the cent goes to Needs, the largest part)
    expect(plan.savings[0]?.expected).toEqual(kzt(20_000_000n));
    expect(plan.savings[0]?.accounts).toEqual([]);
    expect(plan.spending).toBeNull(); // the user already has an everyday card
  });

  it('marks the recommendation opened when a deposit is linked to the envelope (DEP-3)', () => {
    const deposit = account('dep', 'deposit', 'savings');
    const plan = buildDepositPlan(ENVELOPES, [account('cash', 'cash'), deposit], kzt(100_000n));
    expect(plan.savings[0]?.accounts).toEqual([deposit]);
  });

  it('suggests an everyday account with the rest of the month when the user has none', () => {
    const plan = buildDepositPlan(ENVELOPES, [account('cash', 'cash')], kzt(100_000n));
    expect(plan.spending).toEqual({ expected: kzt(80_000n) });
  });

  it('has no amounts without income history', () => {
    const plan = buildDepositPlan(ENVELOPES, [], null);
    expect(plan.savings[0]?.expected).toBeNull();
    expect(plan.spending).toEqual({ expected: null });
  });

  it('a 0 % savings envelope expects zero, and a budget without savings has no recommendations', () => {
    const zeroSavings = [envelope('a', 'custom', 10000, 0), envelope('s', 'savings', 0, 1)];
    expect(buildDepositPlan(zeroSavings, [], kzt(100n)).savings[0]?.expected).toEqual(kzt(0n));
    expect(buildDepositPlan([envelope('a', 'custom', 10000, 0)], [], kzt(100n)).savings).toEqual([]);
  });
});

describe('goal dates', () => {
  it('adds months and clamps to the last day of the month', () => {
    expect(addMonths('2026-11-20', 6)).toBe('2027-05-20');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
  });

  it('maps a horizon to a date, or none', () => {
    expect(horizonDate('2026-11-20', 'none')).toBeNull();
    expect(horizonDate('2026-11-20', '24')).toBe('2028-11-20');
  });

  it('maps RPC errors', () => {
    expect(toSavingsError('invalid_date')).toBe('invalid_date');
    expect(toSavingsError('nope')).toBe('failed');
  });
});
