import { err, ok, type Result } from '../shared/result';
import { isCurrencyCode } from './currency';
import { isWithinRange, money, type Money } from './money';

/**
 * Wire format for amounts: a canonical base-10 integer string of minor units.
 * Used for RPC parameters, view/RPC results and the query cache, because JSON
 * numbers lose precision above 2^53 and JSON.stringify throws on BigInt.
 */
export type WireAmount = string;

export type FromWireError = 'invalid_format' | 'unknown_currency' | 'out_of_range';

const CANONICAL_INTEGER = /^(0|-?[1-9][0-9]*)$/;

export function toWire(m: Money): WireAmount {
  return m.amountMinor.toString();
}

export function fromWire(amount: string, currency: string): Result<Money, FromWireError> {
  if (!isCurrencyCode(currency)) return err('unknown_currency');
  if (!CANONICAL_INTEGER.test(amount)) return err('invalid_format');
  const amountMinor = BigInt(amount);
  if (!isWithinRange(amountMinor)) return err('out_of_range');
  return ok(money(amountMinor, currency));
}
