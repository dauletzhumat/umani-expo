import { err, ok, type Result } from '../shared/result';
import { minorUnitsOf, type CurrencyCode } from './currency';
import { isWithinRange, money, type Money } from './money';

export type ParseLocale = 'ru' | 'kk' | 'en';

export type ParseMoneyError = 'empty' | 'invalid_format' | 'too_many_decimals' | 'out_of_range';

/** Regular, no-break, narrow no-break and thin spaces used as digit grouping. */
const GROUP_SPACES = /[    ]/g;

/**
 * Parses a user-typed amount into Money.
 * - ru/kk: spaces group digits; `,` or `.` is the decimal separator.
 * - en: `,` groups digits; `.` is the decimal separator.
 * Accepts a leading `-` (or U+2212) / `+`. Fraction digits may not exceed the currency's minor units.
 */
export function parseMoney(
  input: string,
  currency: CurrencyCode,
  locale: ParseLocale,
): Result<Money, ParseMoneyError> {
  let text = input.trim().replace(GROUP_SPACES, '');

  let negative = false;
  const sign = text.charAt(0);
  if (sign === '-' || sign === '−') {
    negative = true;
    text = text.slice(1);
  } else if (sign === '+') {
    text = text.slice(1);
  }

  if (locale === 'en') {
    const point = text.indexOf('.');
    if (text.lastIndexOf(',') > point && point !== -1) return err('invalid_format');
    text = text.replace(/,/g, '');
  } else {
    text = text.replace(',', '.');
  }

  if (!/[0-9]/.test(text)) {
    return /^[.,]?$/.test(text) ? err('empty') : err('invalid_format');
  }

  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(text);
  if (match === null) return err('invalid_format');

  const integerPart = match[1] ?? '';
  const fractionPart = match[2] ?? '';
  const minorUnits = minorUnitsOf(currency);
  if (fractionPart.length > minorUnits) return err('too_many_decimals');

  const digits = (integerPart || '0') + fractionPart.padEnd(minorUnits, '0');
  const magnitude = BigInt(digits);
  const amountMinor = negative ? -magnitude : magnitude;
  if (!isWithinRange(amountMinor)) return err('out_of_range');

  return ok(money(amountMinor, currency));
}
