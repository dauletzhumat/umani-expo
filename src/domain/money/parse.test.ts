import { describe, expect, it } from '@jest/globals';

import { money } from './money';
import { parseMoney } from './parse';

const NBSP = ' ';
const NARROW_NBSP = ' ';

describe('parseMoney — ru/kk', () => {
  it.each(['ru', 'kk'] as const)('%s: comma or dot is the decimal separator, spaces group', (locale) => {
    expect(parseMoney('12 500,50', 'KZT', locale)).toEqual({ ok: true, value: money(1_250_050n, 'KZT') });
    expect(parseMoney(`12${NBSP}500,5`, 'KZT', locale)).toEqual({ ok: true, value: money(1_250_050n, 'KZT') });
    expect(parseMoney(`1${NARROW_NBSP}000${NARROW_NBSP}000`, 'KZT', locale)).toEqual({
      ok: true,
      value: money(100_000_000n, 'KZT'),
    });
    expect(parseMoney('12.5', 'KZT', locale)).toEqual({ ok: true, value: money(1_250n, 'KZT') });
    expect(parseMoney('12500', 'KZT', locale)).toEqual({ ok: true, value: money(1_250_000n, 'KZT') });
  });

  it('rejects two decimal separators', () => {
    expect(parseMoney('1,2,3', 'KZT', 'ru')).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseMoney('1.2,3', 'KZT', 'ru')).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('parseMoney — en', () => {
  it('dot is decimal, comma groups', () => {
    expect(parseMoney('12,500.50', 'USD', 'en')).toEqual({ ok: true, value: money(1_250_050n, 'USD') });
    expect(parseMoney('1,000,000', 'USD', 'en')).toEqual({ ok: true, value: money(100_000_000n, 'USD') });
    expect(parseMoney('0.05', 'USD', 'en')).toEqual({ ok: true, value: money(5n, 'USD') });
    expect(parseMoney('.5', 'USD', 'en')).toEqual({ ok: true, value: money(50n, 'USD') });
  });

  it('rejects a comma after the decimal point and two decimal points', () => {
    expect(parseMoney('1.000,5', 'USD', 'en')).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseMoney('1.2.3', 'USD', 'en')).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('parseMoney — common rules', () => {
  it('handles signs (ASCII minus and U+2212)', () => {
    expect(parseMoney('-5', 'EUR', 'en')).toEqual({ ok: true, value: money(-500n, 'EUR') });
    expect(parseMoney('−5,25', 'EUR', 'ru')).toEqual({ ok: true, value: money(-525n, 'EUR') });
    expect(parseMoney('+5', 'EUR', 'en')).toEqual({ ok: true, value: money(500n, 'EUR') });
  });

  it('trims surrounding whitespace', () => {
    expect(parseMoney('  7 ', 'RUB', 'ru')).toEqual({ ok: true, value: money(700n, 'RUB') });
  });

  it.each(['', '   ', '-', ',', '.'])('rejects empty input %p', (input) => {
    expect(parseMoney(input, 'KZT', 'ru')).toEqual({ ok: false, error: 'empty' });
  });

  it.each(['abc', '12a', '1e5', '--1', '1-', '₸100', '0x10', 'NaN', 'Infinity'])('rejects %p', (input) => {
    expect(parseMoney(input, 'KZT', 'ru')).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('rejects more decimals than the currency allows', () => {
    expect(parseMoney('1,234', 'KZT', 'ru')).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseMoney('0.001', 'USD', 'en')).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('accepts trailing zeros beyond precision only if they are within minor units', () => {
    expect(parseMoney('1,20', 'KZT', 'ru')).toEqual({ ok: true, value: money(120n, 'KZT') });
    expect(parseMoney('1,', 'KZT', 'ru')).toEqual({ ok: true, value: money(100n, 'KZT') });
  });

  it('rejects values beyond the supported range', () => {
    expect(parseMoney('10000000000000', 'KZT', 'ru')).toEqual({ ok: true, value: money(10n ** 15n, 'KZT') });
    expect(parseMoney('10000000000000,01', 'KZT', 'ru')).toEqual({ ok: false, error: 'out_of_range' });
    expect(parseMoney('99999999999999999999', 'KZT', 'ru')).toEqual({ ok: false, error: 'out_of_range' });
  });
});
