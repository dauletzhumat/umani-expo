import { describe, expect, it } from '@jest/globals';

import type { CurrencyCode } from '../money/currency';
import { money } from '../money/money';
import { approximateTotal } from './approximate-total';

const rates = (entries: [CurrencyCode, string][]) => new Map<CurrencyCode, string>(entries);

describe('approximateTotal (Home total in the base currency, PRD ACC-4)', () => {
  it('adds base-currency balances exactly and is not approximate', () => {
    expect(approximateTotal([money(10_000n, 'KZT'), money(-2_500n, 'KZT')], 'KZT', rates([]))).toEqual({
      total: money(7_500n, 'KZT'),
      approximate: false,
      unconverted: [],
    });
  });

  it('converts foreign balances at the given rate and marks the total approximate', () => {
    // 100.00 KZT + 10.00 USD at 475.5 (= 4 755.00 KZT) + 20.00 EUR at 550 (= 11 000.00 KZT)
    const result = approximateTotal(
      [money(10_000n, 'KZT'), money(1_000n, 'USD'), money(2_000n, 'EUR')],
      'KZT',
      rates([
        ['USD', '475.5'],
        ['EUR', '550'],
      ]),
    );
    expect(result).toEqual({ total: money(1_585_500n, 'KZT'), approximate: true, unconverted: [] });
  });

  it('leaves out currencies without a rate and lists each once', () => {
    const result = approximateTotal(
      [money(10_000n, 'KZT'), money(1_000n, 'CNY'), money(500n, 'CNY'), money(100n, 'RUB')],
      'KZT',
      rates([['RUB', '5.4']]),
    );
    expect(result).toEqual({ total: money(10_540n, 'KZT'), approximate: true, unconverted: ['CNY'] });
  });

  it('works for a non-KZT base', () => {
    const result = approximateTotal([money(10_000n, 'USD'), money(47_550n, 'KZT')], 'USD', rates([['KZT', '0.0021']]));
    // 475.50 KZT × 0.0021 = 0.998… → 1.00 USD (half-even on minor units)
    expect(result).toEqual({ total: money(10_100n, 'USD'), approximate: true, unconverted: [] });
  });

  it('is zero and exact for no accounts', () => {
    expect(approximateTotal([], 'EUR', rates([]))).toEqual({
      total: money(0n, 'EUR'),
      approximate: false,
      unconverted: [],
    });
  });

  it('treats a conversion that would overflow as unconverted instead of throwing', () => {
    const result = approximateTotal([money(10n ** 15n - 1n, 'USD')], 'KZT', rates([['USD', '900000']]));
    expect(result).toEqual({ total: money(0n, 'KZT'), approximate: true, unconverted: ['USD'] });
  });
});
