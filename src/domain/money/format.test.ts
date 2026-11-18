import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { CURRENCY_CODES } from './currency';
import { formatAmount, formatMoney } from './format';
import { MAX_ABS_MINOR, money } from './money';
import { parseMoney } from './parse';

const NNBSP = ' '; // narrow no-break space: digit grouping in ru/kk
const NBSP = ' '; // no-break space: between amount and symbol
const MINUS = '−';

describe('formatAmount (number only)', () => {
  it.each([
    ['ru', 1_250_050n, `12${NNBSP}500,50`],
    ['kk', 1_250_050n, `12${NNBSP}500,50`],
    ['en', 1_250_050n, '12,500.50'],
    ['ru', 100_000_000_000n, `1${NNBSP}000${NNBSP}000${NNBSP}000,00`],
    ['en', 5n, '0.05'],
    ['ru', 0n, '0,00'],
    ['ru', 99_999n, `999,99`],
    ['ru', 100_000n, `1${NNBSP}000,00`],
  ] as const)('%s %p → %p', (locale, minor, expected) => {
    expect(formatAmount(money(minor, 'KZT'), locale)).toBe(expected);
  });

  it('uses a typographic minus for negatives', () => {
    expect(formatAmount(money(-125_000n, 'KZT'), 'ru')).toBe(`${MINUS}1${NNBSP}250,00`);
    expect(formatAmount(money(-5n, 'USD'), 'en')).toBe(`${MINUS}0.05`);
  });

  it('can hide a zero fraction (lists) but never a non-zero one', () => {
    expect(formatAmount(money(1_250_000n, 'KZT'), 'ru', { hideZeroFraction: true })).toBe(`12${NNBSP}500`);
    expect(formatAmount(money(1_250_050n, 'KZT'), 'ru', { hideZeroFraction: true })).toBe(`12${NNBSP}500,50`);
  });

  it('sign display: always (+ for income) and never (magnitude only)', () => {
    expect(formatAmount(money(100n, 'KZT'), 'ru', { signDisplay: 'always' })).toBe('+1,00');
    expect(formatAmount(money(0n, 'KZT'), 'ru', { signDisplay: 'always' })).toBe('0,00');
    expect(formatAmount(money(-100n, 'KZT'), 'ru', { signDisplay: 'never' })).toBe('1,00');
  });

  it('formats the largest supported amount exactly (no float rounding)', () => {
    expect(formatAmount(money(MAX_ABS_MINOR, 'KZT'), 'en')).toBe('10,000,000,000,000.00');
    expect(formatAmount(money(MAX_ABS_MINOR - 1n, 'KZT'), 'en')).toBe('9,999,999,999,999.99');
  });

  it('round-trips through parseMoney in every locale and currency', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -MAX_ABS_MINOR, max: MAX_ABS_MINOR }),
        fc.constantFrom(...CURRENCY_CODES),
        fc.constantFrom('ru' as const, 'kk' as const, 'en' as const),
        (minor, currency, locale) => {
          const m = money(minor, currency);
          expect(parseMoney(formatAmount(m, locale), currency, locale)).toEqual({ ok: true, value: m });
        },
      ),
    );
  });
});

describe('formatMoney (with currency symbol, DESIGN_SYSTEM §5)', () => {
  it.each([
    ['ru', 'KZT', 1_250_000n, `12${NNBSP}500,00${NBSP}₸`],
    ['kk', 'KZT', 1_250_000n, `12${NNBSP}500,00${NBSP}₸`],
    ['en', 'KZT', 1_250_000n, `12,500.00${NBSP}₸`],
    ['ru', 'RUB', 99_900n, `999,00${NBSP}₽`],
    ['en', 'RUB', 99_900n, `999.00${NBSP}₽`],
    ['ru', 'USD', 1_250_050n, `12${NNBSP}500,50${NBSP}$`],
    ['en', 'USD', 1_250_050n, '$12,500.50'],
    ['en', 'EUR', 100n, '€1.00'],
    ['en', 'CNY', 100n, '¥1.00'],
    ['kk', 'CNY', 100n, `1,00${NBSP}¥`],
  ] as const)('%s %s %p → %p', (locale, currency, minor, expected) => {
    expect(formatMoney(money(minor, currency), locale)).toBe(expected);
  });

  it('puts the sign before a prefix symbol', () => {
    expect(formatMoney(money(-1_250_050n, 'USD'), 'en')).toBe(`${MINUS}$12,500.50`);
    expect(formatMoney(money(1_250_050n, 'USD'), 'en', { signDisplay: 'always' })).toBe('+$12,500.50');
    expect(formatMoney(money(-125_000n, 'KZT'), 'ru')).toBe(`${MINUS}1${NNBSP}250,00${NBSP}₸`);
  });

  it('passes options through', () => {
    expect(formatMoney(money(1_250_000n, 'KZT'), 'ru', { hideZeroFraction: true })).toBe(`12${NNBSP}500${NBSP}₸`);
  });
});
