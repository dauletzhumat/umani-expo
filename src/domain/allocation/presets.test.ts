import { describe, expect, it } from '@jest/globals';

import { BPS_TOTAL } from '../money/allocate';
import { PRESET_METHODS, isBudgetMethod, presetEnvelopes } from './presets';

describe('budget method presets (PRD BUD-1)', () => {
  it('has exactly the four presets', () => {
    expect([...PRESET_METHODS].sort()).toEqual(['50_30_20', '70_20_10', '80_20', '90_10']);
  });

  it('50/30/20 = needs / wants / savings', () => {
    expect(presetEnvelopes('50_30_20')).toEqual([
      { kind: 'needs', nameKey: 'envelope.needs', allocationBps: 5_000 },
      { kind: 'wants', nameKey: 'envelope.wants', allocationBps: 3_000 },
      { kind: 'savings', nameKey: 'envelope.savings', allocationBps: 2_000 },
    ]);
  });

  it('80/20 = spending / savings', () => {
    expect(presetEnvelopes('80_20')).toEqual([
      { kind: 'spending', nameKey: 'envelope.spending', allocationBps: 8_000 },
      { kind: 'savings', nameKey: 'envelope.savings', allocationBps: 2_000 },
    ]);
  });

  it('90/10 = spending / savings', () => {
    expect(presetEnvelopes('90_10')).toEqual([
      { kind: 'spending', nameKey: 'envelope.spending', allocationBps: 9_000 },
      { kind: 'savings', nameKey: 'envelope.savings', allocationBps: 1_000 },
    ]);
  });

  it('70/20/10 = living / savings / debt & giving', () => {
    expect(presetEnvelopes('70_20_10')).toEqual([
      { kind: 'living', nameKey: 'envelope.living', allocationBps: 7_000 },
      { kind: 'savings', nameKey: 'envelope.savings', allocationBps: 2_000 },
      { kind: 'debt_giving', nameKey: 'envelope.debtGiving', allocationBps: 1_000 },
    ]);
  });

  it.each(PRESET_METHODS.map((m) => [m]))('%s totals exactly 100%% and is immutable', (method) => {
    const envelopes = presetEnvelopes(method);
    expect(envelopes.reduce((a, e) => a + e.allocationBps, 0)).toBe(BPS_TOTAL);
    expect(Object.isFrozen(envelopes)).toBe(true);
    expect(envelopes.every((e) => Object.isFrozen(e))).toBe(true);
  });

  it('guards method names', () => {
    expect(isBudgetMethod('50_30_20')).toBe(true);
    expect(isBudgetMethod('custom')).toBe(true);
    expect(isBudgetMethod('60_40')).toBe(false);
    expect(isBudgetMethod('toString')).toBe(false);
  });
});
