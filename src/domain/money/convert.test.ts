import { describe, expect, it } from '@jest/globals';

import { convert, parseRate } from './convert';
import { MAX_ABS_MINOR, money } from './money';

describe('parseRate', () => {
  it('parses positive decimal strings exactly', () => {
    expect(parseRate('505')).toEqual({ ok: true, value: { units: 505n, scale: 0 } });
    expect(parseRate('505.25')).toEqual({ ok: true, value: { units: 50_525n, scale: 2 } });
    expect(parseRate('0.0019802')).toEqual({ ok: true, value: { units: 19_802n, scale: 7 } });
  });

  it.each(['', '0', '0.000', '-1', '1,5', '1.', '.5', 'abc', '1e3', ' 1', '1.0000000000001', '1000000000000'])(
    'rejects %p',
    (s) => {
      expect(parseRate(s)).toEqual({ ok: false, error: 'invalid_rate' });
    },
  );
});

describe('convert (rate = target units per 1 source unit)', () => {
  it('converts USD → KZT', () => {
    // 1 000.00 USD × 505.00 = 505 000.00 KZT
    expect(convert(money(100_000n, 'USD'), '505.00', 'KZT')).toEqual({ ok: true, value: money(50_500_000n, 'KZT') });
  });

  it('converts KZT → USD with half-even rounding', () => {
    // 12 500.00 KZT / 505 ≈ 24.752475… USD → 24.75
    expect(convert(money(1_250_000n, 'KZT'), '0.0019802', 'USD')).toEqual({ ok: true, value: money(2_475n, 'USD') });
    // 0.25 × 0.5 = 0.125 → 0.12 (half-even)
    expect(convert(money(25n, 'EUR'), '0.5', 'USD')).toEqual({ ok: true, value: money(12n, 'USD') });
    // 0.35 × 0.5 = 0.175 → 0.18 (half-even)
    expect(convert(money(35n, 'EUR'), '0.5', 'USD')).toEqual({ ok: true, value: money(18n, 'USD') });
  });

  it('converts negatives symmetrically', () => {
    expect(convert(money(-25n, 'EUR'), '0.5', 'USD')).toEqual({ ok: true, value: money(-12n, 'USD') });
  });

  it('identity rate keeps the amount', () => {
    expect(convert(money(123n, 'RUB'), '1', 'RUB')).toEqual({ ok: true, value: money(123n, 'RUB') });
  });

  it('reports invalid rates and overflow', () => {
    expect(convert(money(1n, 'USD'), 'x', 'KZT')).toEqual({ ok: false, error: 'invalid_rate' });
    expect(convert(money(MAX_ABS_MINOR, 'USD'), '505', 'KZT')).toEqual({ ok: false, error: 'out_of_range' });
  });
});
