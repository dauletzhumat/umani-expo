import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { divideHalfEven } from './rounding';

describe('divideHalfEven', () => {
  it.each([
    [10n, 4n, 2n], // 2.5 → 2 (even)
    [14n, 4n, 4n], // 3.5 → 4 (even)
    [11n, 4n, 3n], // 2.75 → 3
    [9n, 4n, 2n], // 2.25 → 2
    [8n, 4n, 2n], // exact
    [0n, 7n, 0n],
    [-10n, 4n, -2n], // -2.5 → -2
    [-14n, 4n, -4n], // -3.5 → -4
    [-11n, 4n, -3n], // -2.75 → -3
    [-9n, 4n, -2n], // -2.25 → -2
    [1n, 2n, 0n], // 0.5 → 0
    [3n, 2n, 2n], // 1.5 → 2
    [-1n, 2n, 0n],
  ])('%p / %p = %p', (n, d, expected) => {
    expect(divideHalfEven(n, d)).toBe(expected);
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
