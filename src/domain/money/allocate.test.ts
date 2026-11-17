import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import fixture from '../../../supabase/fixtures/allocation.json';
import { BPS_TOTAL, allocate } from './allocate';
import { MAX_ABS_MINOR, money } from './money';

describe('allocate — shared fixture (parity with SQL)', () => {
  it.each(fixture.cases)('$name', ({ total, weightsBps, expected }) => {
    const result = allocate(money(BigInt(total), 'KZT'), weightsBps);
    expect(result).toEqual({ ok: true, value: expected.map((e) => money(BigInt(e), 'KZT')) });
  });
});

describe('allocate — validation', () => {
  const total = money(100n, 'KZT');

  it('rejects negative totals', () => {
    expect(allocate(money(-1n, 'KZT'), [10_000])).toEqual({ ok: false, error: 'negative_total' });
  });

  it('rejects an empty weight list', () => {
    expect(allocate(total, [])).toEqual({ ok: false, error: 'no_weights' });
  });

  it.each([[[-1, 10_001]], [[0.5, 9_999.5]], [[Number.NaN, 10_000]], [[10_001, -1]]])(
    'rejects invalid weights %p',
    (weights) => {
      expect(allocate(total, weights)).toEqual({ ok: false, error: 'invalid_weight' });
    },
  );

  it('rejects weights that do not total 100%', () => {
    expect(allocate(total, [5_000, 3_000])).toEqual({ ok: false, error: 'weights_not_100_percent' });
    expect(allocate(total, [5_000, 5_001])).toEqual({ ok: false, error: 'weights_not_100_percent' });
    expect(allocate(total, [0, 0])).toEqual({ ok: false, error: 'weights_not_100_percent' });
  });

  it('keeps the currency', () => {
    const result = allocate(money(10n, 'USD'), [5_000, 5_000]);
    expect(result.ok && result.value.every((m) => m.currency === 'USD')).toBe(true);
  });
});

/** Random valid weights: n integers ≥ 0 summing to BPS_TOTAL. */
const weightsArb = fc
  .array(fc.integer({ min: 0, max: BPS_TOTAL }), { minLength: 0, maxLength: 11 })
  .map((cuts) => {
    const points = [0, ...cuts.sort((a, b) => a - b), BPS_TOTAL];
    return points.slice(1).map((p, i) => p - (points[i] as number));
  });

describe('allocate — properties', () => {
  it('parts always sum exactly to the total and are never negative', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_ABS_MINOR }), weightsArb, (total, weights) => {
        const result = allocate(money(total, 'KZT'), weights);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parts = result.value.map((m) => m.amountMinor);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
        expect(parts.every((p) => p >= 0n)).toBe(true);
        expect(parts).toHaveLength(weights.length);
      }),
    );
  });

  it('each part is within one minor unit of its exact share', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_ABS_MINOR }), weightsArb, (total, weights) => {
        const result = allocate(money(total, 'KZT'), weights);
        if (!result.ok) throw new Error('expected ok');
        result.value.forEach((part, i) => {
          const exactTimesBps = total * BigInt(weights[i] as number);
          const floor = exactTimesBps / BigInt(BPS_TOTAL);
          expect(part.amountMinor === floor || part.amountMinor === floor + 1n).toBe(true);
        });
      }),
    );
  });

  it('zero-weight envelopes always get zero', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_ABS_MINOR }), weightsArb, (total, weights) => {
        const result = allocate(money(total, 'KZT'), weights);
        if (!result.ok) throw new Error('expected ok');
        weights.forEach((w, i) => {
          if (w === 0) expect(result.value[i]?.amountMinor).toBe(0n);
        });
      }),
    );
  });
});
