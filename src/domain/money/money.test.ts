import { describe, expect, it } from '@jest/globals';

import { CURRENCY_CODES, isCurrencyCode, minorUnitsOf } from './currency';
import {
  CurrencyMismatchError,
  MAX_ABS_MINOR,
  add,
  compare,
  equals,
  isNegative,
  isPositive,
  isZero,
  money,
  negate,
  subtract,
  sum,
  zero,
} from './money';

describe('currency', () => {
  it('supports exactly KZT, USD, EUR, RUB, CNY', () => {
    expect([...CURRENCY_CODES].sort()).toEqual(['CNY', 'EUR', 'KZT', 'RUB', 'USD']);
  });

  it('knows minor units (ISO 4217)', () => {
    for (const code of CURRENCY_CODES) expect(minorUnitsOf(code)).toBe(2);
  });

  it('guards currency codes', () => {
    expect(isCurrencyCode('KZT')).toBe(true);
    expect(isCurrencyCode('kzt')).toBe(false);
    expect(isCurrencyCode('GBP')).toBe(false);
    expect(isCurrencyCode('')).toBe(false);
    expect(isCurrencyCode('toString')).toBe(false);
  });
});

describe('money()', () => {
  it('creates an immutable value', () => {
    const m = money(12_500n, 'KZT');
    expect(m).toEqual({ amountMinor: 12_500n, currency: 'KZT' });
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('accepts the limits and rejects beyond them', () => {
    expect(money(MAX_ABS_MINOR, 'USD').amountMinor).toBe(MAX_ABS_MINOR);
    expect(money(-MAX_ABS_MINOR, 'USD').amountMinor).toBe(-MAX_ABS_MINOR);
    expect(() => money(MAX_ABS_MINOR + 1n, 'USD')).toThrow(RangeError);
    expect(() => money(-MAX_ABS_MINOR - 1n, 'USD')).toThrow(RangeError);
  });

  it('zero()', () => {
    expect(zero('EUR')).toEqual({ amountMinor: 0n, currency: 'EUR' });
  });
});

describe('arithmetic', () => {
  const a = money(1_000n, 'KZT');
  const b = money(250n, 'KZT');

  it('adds and subtracts', () => {
    expect(add(a, b)).toEqual(money(1_250n, 'KZT'));
    expect(subtract(a, b)).toEqual(money(750n, 'KZT'));
    expect(subtract(b, a)).toEqual(money(-750n, 'KZT'));
  });

  it('negates', () => {
    expect(negate(a)).toEqual(money(-1_000n, 'KZT'));
    expect(negate(zero('KZT')).amountMinor).toBe(0n);
  });

  it('refuses to mix currencies', () => {
    const usd = money(1n, 'USD');
    expect(() => add(a, usd)).toThrow(CurrencyMismatchError);
    expect(() => subtract(a, usd)).toThrow(CurrencyMismatchError);
    expect(() => compare(a, usd)).toThrow(CurrencyMismatchError);
    expect(() => sum([a, usd], 'KZT')).toThrow(CurrencyMismatchError);
  });

  it('throws when a result leaves the supported range', () => {
    expect(() => add(money(MAX_ABS_MINOR, 'KZT'), money(1n, 'KZT'))).toThrow(RangeError);
  });

  it('sums lists, including empty ones', () => {
    expect(sum([], 'RUB')).toEqual(zero('RUB'));
    expect(sum([money(1n, 'RUB'), money(2n, 'RUB'), money(-4n, 'RUB')], 'RUB')).toEqual(money(-1n, 'RUB'));
  });
});

describe('comparison', () => {
  it('compares within a currency', () => {
    expect(compare(money(1n, 'CNY'), money(2n, 'CNY'))).toBe(-1);
    expect(compare(money(2n, 'CNY'), money(2n, 'CNY'))).toBe(0);
    expect(compare(money(3n, 'CNY'), money(2n, 'CNY'))).toBe(1);
  });

  it('checks equality including currency', () => {
    expect(equals(money(5n, 'USD'), money(5n, 'USD'))).toBe(true);
    expect(equals(money(5n, 'USD'), money(5n, 'EUR'))).toBe(false);
    expect(equals(money(5n, 'USD'), money(6n, 'USD'))).toBe(false);
  });

  it('classifies sign', () => {
    expect(isZero(zero('KZT'))).toBe(true);
    expect(isPositive(money(1n, 'KZT'))).toBe(true);
    expect(isNegative(money(-1n, 'KZT'))).toBe(true);
    expect(isPositive(zero('KZT'))).toBe(false);
    expect(isNegative(zero('KZT'))).toBe(false);
  });
});
