import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { convert } from '../money/convert';
import { money } from '../money/money';
import { effectiveRate } from './effective-rate';

describe('effectiveRate (units received per one unit sent, PRD ACC-6)', () => {
  it.each([
    // 50 000.00 KZT → 100.00 USD: 1 KZT buys 0.002 USD
    [money(5_000_000n, 'KZT'), money(10_000n, 'USD'), '0.002'],
    // 100.00 USD → 47 550.00 KZT
    [money(10_000n, 'USD'), money(4_755_000n, 'KZT'), '475.5'],
    // 3.00 USD → 1 000.00 KZT: 333.333333… rounded half-even at 6 places
    [money(300n, 'USD'), money(100_000n, 'KZT'), '333.333333'],
    // 0.07 USD → 0.01 EUR = 0.142857142… → 0.142857
    [money(7n, 'USD'), money(1n, 'EUR'), '0.142857'],
    // same currency, same amount
    [money(12_345n, 'KZT'), money(12_345n, 'KZT'), '1'],
  ])('%o → %o = %s', (sent, received, expected) => {
    expect(effectiveRate(sent, received)).toEqual({ ok: true, value: expected });
  });

  it('rounds half to even at the last place', () => {
    // 2.00 USD → 1.00 EUR: 0.5 exactly; 8.00 USD → 0.01 EUR = 0.00125 → 0.001 at 3 places
    expect(effectiveRate(money(200n, 'USD'), money(100n, 'EUR'))).toEqual({ ok: true, value: '0.5' });
    expect(effectiveRate(money(800n, 'USD'), money(1n, 'EUR'), 3)).toEqual({ ok: true, value: '0.001' });
    expect(effectiveRate(money(800n, 'USD'), money(3n, 'EUR'), 3)).toEqual({ ok: true, value: '0.004' });
  });

  it.each([
    [money(0n, 'KZT'), money(100n, 'USD')],
    [money(100n, 'KZT'), money(0n, 'USD')],
    [money(-100n, 'KZT'), money(100n, 'USD')],
  ])('rejects non-positive amounts (%o → %o)', (sent, received) => {
    expect(effectiveRate(sent, received)).toEqual({ ok: false, error: 'non_positive_amount' });
  });

  it('converting the sent amount at the derived rate lands within rounding of the received amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 100n, max: 10n ** 12n }),
        fc.bigInt({ min: 100n, max: 10n ** 12n }),
        (sentMinor, receivedMinor) => {
          const sent = money(sentMinor, 'USD');
          const rate = effectiveRate(sent, money(receivedMinor, 'KZT'), 12);
          if (!rate.ok) return false;
          const back = convert(sent, rate.value, 'KZT');
          if (!back.ok) return false;
          const diff = back.value.amountMinor - receivedMinor;
          // a 12-place rate is off by ≤ 0.5e-12 per unit sent → ≤ 1 + sent/10^10 minor units
          return (diff < 0n ? -diff : diff) <= 1n + sentMinor / 10n ** 10n;
        },
      ),
    );
  });
});
