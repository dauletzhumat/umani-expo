import { describe, expect, it } from '@jest/globals';

import { daysBetween, feedDate, isIsoDate, isPlausibleMove, parseNbkRates } from './parse';

const WANTED = new Set(['USD', 'EUR', 'RUB', 'CNY']);

// Shape of the real feed with synthetic values.
const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rates>
    <title>Official exchange rates of National Bank of Republic Kazakhstan</title>
    <date>18.11.2026</date>
    <item><fullname>АВСТРАЛИЙСКИЙ ДОЛЛАР</fullname><title>AUD</title><description>299.1</description><quant>1</quant></item>
    <item>
        <fullname>ДОЛЛАР США</fullname>
        <title>USD</title>
        <description>443.96</description>
        <quant>1</quant>
        <index>DOWN</index>
    </item>
    <item><title>EUR</title><description>487.73</description><quant>1</quant></item>
    <item><title>RUB</title><description>53.8</description><quant>10</quant></item>
    <item><title>CNY</title><description>66.6</description><quant>1</quant></item>
</rates>`;

describe('parseNbkRates', () => {
  it('reads the date and the wanted currencies as exact decimal strings', () => {
    const result = parseNbkRates(FEED, WANTED);
    expect(result).toEqual({
      ok: true,
      value: {
        rateDate: '2026-11-18',
        rates: [
          { currency: 'USD', kztPerUnit: '443.96' },
          { currency: 'EUR', kztPerUnit: '487.73' },
          { currency: 'RUB', kztPerUnit: '5.38' }, // 53.8 per 10 units
          { currency: 'CNY', kztPerUnit: '66.6' },
        ],
      },
    });
  });

  it.each([
    ['12.47', '10', '1.247'],
    ['5', '100', '0.05'],
    ['1250', '1000', '1.25'],
    ['443.96', '1', '443.96'],
  ])('divides %s by quant %s exactly → %s', (value, quant, expected) => {
    const xml = `<date>01.01.2027</date><item><title>USD</title><description>${value}</description><quant>${quant}</quant></item>`;
    const result = parseNbkRates(xml, WANTED);
    expect(result.ok && result.value.rates[0]?.kztPerUnit).toBe(expected);
  });

  it.each([
    ['a non-numeric value', '<description>n/a</description><quant>1</quant>'],
    ['a negative value', '<description>-1.5</description><quant>1</quant>'],
    ['a zero value', '<description>0.00</description><quant>1</quant>'],
    ['an unusual quant', '<description>12</description><quant>3</quant>'],
    ['a missing quant', '<description>12</description>'],
  ])('skips an item with %s', (_label, body) => {
    const xml = `<date>01.01.2027</date><item><title>USD</title>${body}</item>`;
    expect(parseNbkRates(xml, WANTED)).toEqual({ ok: false, error: 'no_rates' });
  });

  it('keeps only the first item of a duplicated currency', () => {
    const xml = `<date>01.01.2027</date>
      <item><title>USD</title><description>440</description><quant>1</quant></item>
      <item><title>USD</title><description>999</description><quant>1</quant></item>`;
    const result = parseNbkRates(xml, WANTED);
    expect(result.ok && result.value.rates).toEqual([{ currency: 'USD', kztPerUnit: '440' }]);
  });

  it('fails without a date', () => {
    expect(parseNbkRates('<rates><item><title>USD</title></item></rates>', WANTED)).toEqual({
      ok: false,
      error: 'missing_date',
    });
  });

  it('fails when no wanted currency is present (e.g. an error page)', () => {
    expect(parseNbkRates('<html><date>01.01.2027</date></html>', WANTED)).toEqual({ ok: false, error: 'no_rates' });
  });
});

describe('feedDate', () => {
  it('formats an ISO date the way the feed expects', () => {
    expect(feedDate('2026-11-08')).toBe('08.11.2026');
  });
});

describe('isIsoDate', () => {
  it.each([
    ['2026-11-19', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-45', false],
    ['2026-1-9', false],
    ['19.11.2026', false],
  ])('%s → %p', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-11-12', '2026-11-19')).toBe(7);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('isPlausibleMove', () => {
  it.each([
    [null, '443.96', true],
    ['443.96', '444.4', true],
    ['443.96', '320', true], // −28%
    ['443.96', '300', false], // −32%
    ['443.96', '630', true], // +42% is the inverse of −30%
    ['443.96', '650', false],
    ['443.96', '44396', false], // a quant mix-up (×100)
  ])('%s → %s: %p', (previous, next, expected) => {
    expect(isPlausibleMove(previous, next)).toBe(expected);
  });
});
