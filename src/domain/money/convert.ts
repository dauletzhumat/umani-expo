import { err, ok, type Result } from '../shared/result';
import { minorUnitsOf, type CurrencyCode } from './currency';
import { isWithinRange, money, type Money } from './money';
import { divideHalfEven } from './rounding';

/** An exact positive decimal rate: value = units / 10^scale. */
export type Rate = Readonly<{ units: bigint; scale: number }>;

export type RateError = 'invalid_rate';
export type ConvertError = RateError | 'out_of_range';

/** ≤ 12 integer digits and ≤ 12 decimals: fits `numeric(24,12)`; same rule as private.parse_rate. */
const RATE_PATTERN = /^([0-9]{1,12})(?:\.([0-9]{1,12}))?$/;

/** Parses a strict decimal string ("505", "505.25"), > 0, at most 12 + 12 digits. Never a float. */
export function parseRate(input: string): Result<Rate, RateError> {
  const match = RATE_PATTERN.exec(input);
  if (match === null) return err('invalid_rate');
  const fraction = match[2] ?? '';
  const units = BigInt((match[1] ?? '') + fraction);
  if (units === 0n) return err('invalid_rate');
  return ok(Object.freeze({ units, scale: fraction.length }));
}

/**
 * Converts money with `rate` = target units per 1 source unit, rounding half to even.
 * result_minor = amount_minor × rate × 10^(target_minor_units − source_minor_units)
 */
export function convert(source: Money, rate: string, target: CurrencyCode): Result<Money, ConvertError> {
  const parsed = parseRate(rate);
  if (!parsed.ok) return parsed;

  const numerator = source.amountMinor * parsed.value.units * 10n ** BigInt(minorUnitsOf(target));
  const denominator = 10n ** BigInt(parsed.value.scale + minorUnitsOf(source.currency));
  const amountMinor = divideHalfEven(numerator, denominator);

  if (!isWithinRange(amountMinor)) return err('out_of_range');
  return ok(money(amountMinor, target));
}
