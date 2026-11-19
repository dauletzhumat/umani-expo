import { describe, expect, it } from '@jest/globals';

import { presetEnvelopes } from '@/domain/allocation/presets';
import { money } from '@/domain/money/money';

import {
  bpsLabel,
  planMethodSwitch,
  toBudgetError,
  toEnvelope,
  toIncomeEntries,
  type Envelope,
  type EnvelopeRow,
} from './budget';

const env = (id: string, kind: Envelope['kind'], sortOrder: number, balance = 0n): Envelope => ({
  id,
  name: null,
  nameKey: `envelope.${kind}`,
  kind,
  allocationBps: 0,
  sortOrder,
  balance: money(balance, 'KZT'),
});

describe('toEnvelope', () => {
  const row: EnvelopeRow = {
    envelope_id: '11111111-1111-4111-8111-111111111111',
    name: null,
    name_key: 'envelope.needs',
    kind: 'needs',
    allocation_bps: 5000,
    sort_order: 0,
    balance_minor: '-12345',
  };
  it('keeps negative balances exact (overspent envelopes)', () => {
    expect(toEnvelope(row, 'KZT')?.balance).toEqual(money(-12_345n, 'KZT'));
  });
  it('treats a missing sum as zero and rejects garbage', () => {
    expect(toEnvelope({ ...row, balance_minor: null }, 'KZT')?.balance).toEqual(money(0n, 'KZT'));
    expect(toEnvelope({ ...row, balance_minor: '1.5' }, 'KZT')).toBeNull();
  });
});

describe('toIncomeEntries', () => {
  it('picks the user-account line of each entry and skips entries without one', () => {
    const entries = [
      { id: 'e1', occurred_on: '2026-11-19', note: null, category_id: null },
      { id: 'e2', occurred_on: '2026-11-18', note: 'x', category_id: null },
    ];
    const lines = [{ entry_id: 'e1', account_id: 'acc', currency: 'USD', amount: '10050' }];
    expect(toIncomeEntries(entries, lines, new Set(['acc']))).toEqual([
      { id: 'e1', occurredOn: '2026-11-19', note: null, categoryId: null, accountId: 'acc', amount: money(10_050n, 'USD') },
    ]);
  });
});

describe('bpsLabel', () => {
  it.each([
    [5000, 'ru', '50'],
    [3333, 'ru', '33,33'],
    [1250, 'en', '12.5'],
    [1, 'en', '0.01'],
  ] as const)('%d → %s %s', (bps, locale, expected) => {
    expect(bpsLabel(bps, locale)).toBe(expected);
  });
});

describe('planMethodSwitch (mirrors api.change_budget_method)', () => {
  const current = [env('needs', 'needs', 0, 500n), env('wants', 'wants', 1, 300n), env('sav', 'savings', 2, 200n), env('un', 'unallocated', 1000, 50n)];

  it('a preset keeps envelopes of the same kind and removes the rest', () => {
    const plan = planMethodSwitch(current, presetEnvelopes('80_20'), []);
    expect(plan.layout).toEqual([
      { name: null, nameKey: 'envelope.spending', keepId: null },
      { name: null, nameKey: 'envelope.savings', keepId: 'sav' },
    ]);
    expect(plan.removed.map((e) => e.id)).toEqual(['needs', 'wants']);
  });

  it('a custom layout keeps only the envelopes it names; Unallocated is never removed', () => {
    const plan = planMethodSwitch(current, null, [{ name: 'Food', envelopeId: 'needs' }, { name: 'Fun' }]);
    expect(plan.layout.map((s) => s.keepId)).toEqual(['needs', null]);
    expect(plan.removed.map((e) => e.id)).toEqual(['wants', 'sav']);
  });

  it('ignores ids that are not active envelopes', () => {
    const plan = planMethodSwitch(current, null, [{ name: 'X', envelopeId: 'gone' }]);
    expect(plan.layout[0]?.keepId).toBeNull();
  });
});

describe('toBudgetError', () => {
  it('passes known codes and maps the rest to failed', () => {
    expect(toBudgetError('exceeds_total')).toBe('exceeds_total');
    expect(toBudgetError('weird')).toBe('failed');
  });
});
