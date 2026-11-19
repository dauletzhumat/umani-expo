import { minorUnitsOf } from '../money/currency';
import type { Money } from '../money/money';
import { divideHalfEven } from '../money/rounding';
import { err, ok, type Result } from '../shared/result';

/**
 * The rate a cross-currency transfer implies: units of `received` per one unit of `sent`, as a
 * decimal string rounded half to even at `places` decimals, trailing zeros trimmed (PRD ACC-6:
 * the user enters both amounts; the app derives and shows the rate). Exact bigint arithmetic.
 */
export function effectiveRate(sent: Money, received: Money, places = 6): Result<string, 'non_positive_amount'> {
  if (sent.amountMinor <= 0n || received.amountMinor <= 0n) return err('non_positive_amount');
  // (received / 10^mR) / (sent / 10^mS), scaled by 10^places
  const numerator = received.amountMinor * 10n ** BigInt(minorUnitsOf(sent.currency) + places);
  const denominator = sent.amountMinor * 10n ** BigInt(minorUnitsOf(received.currency));
  const scaled = divideHalfEven(numerator, denominator).toString().padStart(places + 1, '0');
  const whole = scaled.slice(0, scaled.length - places);
  const fraction = scaled.slice(scaled.length - places).replace(/0+$/, '');
  return ok(fraction === '' ? whole : `${whole}.${fraction}`);
}
