import { describe, expect, it } from '@jest/globals';

import { MAX_CUSTOM_ENVELOPES, MAX_ENVELOPE_NAME_LENGTH, parsePercentToBps, validateCustomBudget } from './custom';

describe('parsePercentToBps', () => {
  it.each([
    ['50', 5_000],
    ['33,33', 3_333],
    ['33.33', 3_333],
    ['0,01', 1],
    ['100', 10_000],
    ['12,5', 1_250],
    [' 20 % ', 2_000],
    ['20%', 2_000],
  ])('%p → %p bps', (input, bps) => {
    expect(parsePercentToBps(input)).toEqual({ ok: true, value: bps });
  });

  it.each(['', '0', '0,00', '100,01', '101', '-5', '33,333', 'abc', '1,2,3', '%', '1e2'])('rejects %p', (input) => {
    expect(parsePercentToBps(input)).toEqual({ ok: false, error: 'invalid_percentage' });
  });
});

describe('validateCustomBudget (PRD BUD-2)', () => {
  it('accepts a valid budget, trims names and defaults kind to custom', () => {
    const result = validateCustomBudget([
      { name: '  Аренда ', allocationBps: 4_000 },
      { name: 'Подушка', allocationBps: 3_500, kind: 'savings' },
      { name: 'Жизнь', allocationBps: 2_500 },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { kind: 'custom', name: 'Аренда', allocationBps: 4_000 },
        { kind: 'savings', name: 'Подушка', allocationBps: 3_500 },
        { kind: 'custom', name: 'Жизнь', allocationBps: 2_500 },
      ],
    });
  });

  it('allows a single 100% envelope', () => {
    expect(validateCustomBudget([{ name: 'Всё', allocationBps: 10_000 }]).ok).toBe(true);
  });

  it('requires 1 to 12 envelopes', () => {
    expect(validateCustomBudget([])).toEqual({ ok: false, error: { code: 'too_few_envelopes' } });
    const many = Array.from({ length: MAX_CUSTOM_ENVELOPES + 1 }, (_, i) => ({
      name: `E${i}`,
      allocationBps: i === 0 ? 10_000 - MAX_CUSTOM_ENVELOPES : 1,
    }));
    expect(validateCustomBudget(many)).toEqual({ ok: false, error: { code: 'too_many_envelopes' } });
  });

  it('rejects empty and over-long names, pointing at the envelope', () => {
    expect(
      validateCustomBudget([
        { name: 'A', allocationBps: 5_000 },
        { name: '   ', allocationBps: 5_000 },
      ]),
    ).toEqual({ ok: false, error: { code: 'invalid_name', index: 1 } });
    expect(
      validateCustomBudget([{ name: 'x'.repeat(MAX_ENVELOPE_NAME_LENGTH + 1), allocationBps: 10_000 }]),
    ).toEqual({ ok: false, error: { code: 'invalid_name', index: 0 } });
    expect(validateCustomBudget([{ name: 'x'.repeat(MAX_ENVELOPE_NAME_LENGTH), allocationBps: 10_000 }]).ok).toBe(true);
  });

  it('rejects duplicate names case-insensitively after trimming', () => {
    expect(
      validateCustomBudget([
        { name: 'Еда', allocationBps: 5_000 },
        { name: ' еда ', allocationBps: 5_000 },
      ]),
    ).toEqual({ ok: false, error: { code: 'duplicate_name', index: 1 } });
  });

  it.each([0, -1, 10_001, 12.5, Number.NaN])('rejects percentage %p', (bps) => {
    expect(
      validateCustomBudget([
        { name: 'A', allocationBps: 10_000 },
        { name: 'B', allocationBps: bps },
      ]),
    ).toEqual({ ok: false, error: { code: 'invalid_percentage', index: 1 } });
  });

  it('requires exactly 100% and reports the actual total', () => {
    expect(
      validateCustomBudget([
        { name: 'A', allocationBps: 5_000 },
        { name: 'B', allocationBps: 4_999 },
      ]),
    ).toEqual({ ok: false, error: { code: 'not_100_percent', totalBps: 9_999 } });
  });
});
