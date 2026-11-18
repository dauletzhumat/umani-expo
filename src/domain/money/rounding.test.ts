import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import fixture from '../../../supabase/fixtures/rounding.json';
import { divideHalfEven } from './rounding';

describe('divideHalfEven', () => {
  // shared with pgTAP (private.div_half_even): 2.5 → 2, 3.5 → 4, -2.5 → -2, …
  it.each(fixture.divideHalfEven)('$numerator / $denominator = $expected', ({ numerator, denominator, expected }) => {
    expect(divideHalfEven(BigInt(numerator), BigInt(denominator))).toBe(BigInt(expected));
  });

  it('rejects non-positive denominators', () => {
    expect(() => divideHalfEven(1n, 0n)).toThrow(RangeError);
    expect(() => divideHalfEven(1n, -2n)).toThrow(RangeError);
  });

  it('is within half a unit of the exact quotient and symmetric in sign', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), (n, d) => {
        const q = divideHalfEven(n, d);
        const diff = n - q * d; // remainder relative to the rounded quotient
        expect(2n * (diff < 0n ? -diff : diff) <= d).toBe(true);
        expect(divideHalfEven(-n, d)).toBe(-q);
      }),
    );
  });
});
