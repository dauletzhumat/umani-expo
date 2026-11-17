import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { CURRENCY_CODES } from './currency';
import { MAX_ABS_MINOR, money } from './money';
import { fromWire, toWire } from './wire';

describe('wire format (amounts as strings)', () => {
  it('serialises to a plain integer string', () => {
    expect(toWire(money(1_250_050n, 'KZT'))).toBe('1250050');
    expect(toWire(money(-5n, 'USD'))).toBe('-5');
    expect(toWire(money(0n, 'USD'))).toBe('0');
  });

  it('parses valid strings', () => {
    expect(fromWire('1250050', 'KZT')).toEqual({ ok: true, value: money(1_250_050n, 'KZT') });
    expect(fromWire('-5', 'USD')).toEqual({ ok: true, value: money(-5n, 'USD') });
    expect(fromWire('0', 'EUR')).toEqual({ ok: true, value: money(0n, 'EUR') });
  });

  it.each(['', ' 1', '1 ', '1.0', '01', '-0', '+1', '1e3', 'abc', '--1', '0x1'])('rejects malformed %p', (s) => {
    expect(fromWire(s, 'KZT')).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('rejects unknown currencies and out-of-range values', () => {
    expect(fromWire('1', 'GBP')).toEqual({ ok: false, error: 'unknown_currency' });
    expect(fromWire((MAX_ABS_MINOR + 1n).toString(), 'KZT')).toEqual({ ok: false, error: 'out_of_range' });
  });

  it('round-trips every valid amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -MAX_ABS_MINOR, max: MAX_ABS_MINOR }),
        fc.constantFrom(...CURRENCY_CODES),
        (amount, currency) => {
          const m = money(amount, currency);
          expect(fromWire(toWire(m), currency)).toEqual({ ok: true, value: m });
        },
      ),
    );
  });
});
