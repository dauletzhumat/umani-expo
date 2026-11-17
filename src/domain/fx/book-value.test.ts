import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import fixture from '../../../supabase/fixtures/fx.json';
import { isCurrencyCode, type CurrencyCode } from '../money/currency';
import { money, type Money } from '../money/money';
import { bookPosition, revalue, valueIncoming, valueOutgoing, valueTransfer, type BookPosition } from './book-value';

const BASE: CurrencyCode = 'KZT';

function code(c: string): CurrencyCode {
  if (!isCurrencyCode(c)) throw new Error(`bad fixture currency ${c}`);
  return c;
}
const m = (amount: string, currency: string): Money => money(BigInt(amount), code(currency));
const pos = (balance: string, bookValue: string, currency: string): BookPosition =>
  bookPosition(m(balance, currency), m(bookValue, BASE));
const rateOf = (r: string | null) => r ?? undefined;

describe('shared fixture (parity with SQL)', () => {
  it.each(fixture.incoming)('incoming: $name', (c) => {
    expect(valueIncoming(m(c.amount, c.currency), BASE, rateOf(c.rate))).toEqual({
      ok: true,
      value: m(c.expectedBase, BASE),
    });
  });

  it.each(fixture.outgoing)('outgoing: $name', (c) => {
    expect(valueOutgoing(pos(c.balance, c.bookValue, c.currency), m(c.amount, c.currency), rateOf(c.rate))).toEqual({
      ok: true,
      value: m(c.expectedBase, BASE),
    });
  });

  it.each(fixture.transfer)('transfer: $name', (c) => {
    const result = valueTransfer(
      pos(c.balance, c.bookValue, c.fromCurrency),
      m(c.sent, c.fromCurrency),
      m(c.received, c.toCurrency),
      rateOf(c.rate),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        baseOut: m(c.expectedBaseOut, BASE),
        baseIn: m(c.expectedBaseIn, BASE),
        fxResult: m(c.expectedFxResult, BASE),
      },
    });
  });

  it.each(fixture.revalue)('revalue: $name', (c) => {
    expect(revalue(pos(c.balance, c.bookValue, c.currency), c.rate)).toEqual({
      ok: true,
      value: { target: m(c.expectedTarget, BASE), delta: m(c.expectedDelta, BASE) },
    });
  });
});

describe('bookPosition', () => {
  it('requires a base-currency account to have book value = balance', () => {
    expect(() => bookPosition(m('100', 'KZT'), m('100', 'KZT'))).not.toThrow();
    expect(() => bookPosition(m('100', 'KZT'), m('99', 'KZT'))).toThrow(RangeError);
  });
});

describe('validation', () => {
  const usd = pos('100000', '50500000', 'USD');

  it('valueIncoming', () => {
    expect(valueIncoming(m('0', 'USD'), BASE, '505')).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(valueIncoming(m('1', 'USD'), BASE)).toEqual({ ok: false, error: 'rate_required' });
    expect(valueIncoming(m('1', 'USD'), BASE, 'abc')).toEqual({ ok: false, error: 'invalid_rate' });
    expect(valueIncoming(m('1000000000000000', 'USD'), BASE, '505')).toEqual({ ok: false, error: 'out_of_range' });
  });

  it('valueOutgoing', () => {
    expect(valueOutgoing(usd, m('0', 'USD'))).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(valueOutgoing(usd, m('1', 'EUR'))).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(valueOutgoing(usd, m('100001', 'USD'))).toEqual({ ok: false, error: 'rate_required' });
    expect(valueOutgoing(usd, m('100001', 'USD'), 'x')).toEqual({ ok: false, error: 'invalid_rate' });
    // the rate is only used for an overdraft; within the balance it is ignored
    expect(valueOutgoing(usd, m('1000', 'USD'), 'x')).toEqual({ ok: true, value: m('505000', BASE) });
    // average part + overdraft part beyond the supported range
    expect(valueOutgoing(pos('1', '1000000000000000', 'USD'), m('2', 'USD'), '1000')).toEqual({
      ok: false,
      error: 'out_of_range',
    });
  });

  it('valueTransfer', () => {
    expect(valueTransfer(usd, m('10', 'USD'), m('11', 'USD'))).toEqual({ ok: false, error: 'amount_mismatch' });
    expect(valueTransfer(usd, m('10', 'USD'), m('0', 'KZT'))).toEqual({ ok: false, error: 'non_positive_amount' });
    expect(valueTransfer(usd, m('10', 'EUR'), m('10', 'KZT'))).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(valueTransfer(usd, m('100001', 'USD'), m('1', 'KZT'))).toEqual({ ok: false, error: 'rate_required' });
  });

  it('revalue', () => {
    expect(revalue(pos('100', '100', 'KZT'), '1')).toEqual({ ok: false, error: 'not_foreign_currency' });
    expect(revalue(usd, '0')).toEqual({ ok: false, error: 'invalid_rate' });
    expect(revalue(pos('1000000000000000', '0', 'USD'), '505')).toEqual({ ok: false, error: 'out_of_range' });
    // target fits, but the delta against a negative book value does not
    expect(revalue(pos('1000000000000', '-1000', 'USD'), '1000')).toEqual({ ok: false, error: 'out_of_range' });
  });
});

describe('properties', () => {
  const positionArb = fc
    .record({ balance: fc.bigInt({ min: 1n, max: 10n ** 12n }), avgRateCents: fc.bigInt({ min: 1n, max: 100_000n }) })
    .map(({ balance, avgRateCents }) => ({ balance, book: (balance * avgRateCents) / 100n }));

  it('outgoing within the balance stays between 0 and the book value', () => {
    fc.assert(
      fc.property(positionArb, fc.bigInt({ min: 1n, max: 10n ** 12n }), ({ balance, book }, raw) => {
        const amount = 1n + (raw % balance);
        const result = valueOutgoing(bookPosition(money(balance, 'USD'), money(book, BASE)), money(amount, 'USD'));
        if (!result.ok) throw new Error(result.error);
        expect(result.value.amountMinor >= 0n && result.value.amountMinor <= book).toBe(true);
      }),
    );
  });

  it('spending a balance in two steps uses up exactly the book value', () => {
    fc.assert(
      fc.property(positionArb, fc.bigInt({ min: 1n, max: 10n ** 12n }), ({ balance, book }, raw) => {
        const first = 1n + (raw % balance);
        const start = bookPosition(money(balance, 'USD'), money(book, BASE));
        const out1 = valueOutgoing(start, money(first, 'USD'));
        if (!out1.ok) throw new Error(out1.error);
        const remaining = balance - first;
        if (remaining === 0n) {
          expect(out1.value.amountMinor).toBe(book);
          return;
        }
        const next = bookPosition(money(remaining, 'USD'), money(book - out1.value.amountMinor, BASE));
        const out2 = valueOutgoing(next, money(remaining, 'USD'));
        if (!out2.ok) throw new Error(out2.error);
        expect(out1.value.amountMinor + out2.value.amountMinor).toBe(book);
      }),
    );
  });

  it('transfer: baseIn − baseOut = fxResult; only a base-currency destination realises a result', () => {
    fc.assert(
      fc.property(
        positionArb,
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 14n }),
        fc.constantFrom<CurrencyCode>('KZT', 'EUR', 'RUB', 'CNY'),
        ({ balance, book }, raw, received, to) => {
          const sent = 1n + (raw % balance);
          const result = valueTransfer(
            bookPosition(money(balance, 'USD'), money(book, BASE)),
            money(sent, 'USD'),
            money(received, to),
          );
          if (!result.ok) throw new Error(result.error);
          const { baseOut, baseIn, fxResult } = result.value;
          expect(baseIn.amountMinor - baseOut.amountMinor).toBe(fxResult.amountMinor);
          if (to === BASE) expect(baseIn.amountMinor).toBe(received);
          else expect(fxResult.amountMinor).toBe(0n);
        },
      ),
    );
  });
});
