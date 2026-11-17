import { convert } from '../money/convert';
import type { CurrencyCode } from '../money/currency';
import { isWithinRange, money, type Money } from '../money/money';
import { divideHalfEven } from '../money/rounding';
import { err, ok, type Result } from '../shared/result';

/**
 * Book-value rules for budgeting in one base currency (DATABASE.md §5a R2/R4, ADR 8).
 * Mirrored in SQL; both are checked against supabase/fixtures/fx.json.
 */

/**
 * An account's position: its balance in the account currency and its book value
 * (what that balance is worth to the budget) in the base currency. For an account
 * in the base currency the two are always equal.
 */
export type BookPosition = Readonly<{ balance: Money; bookValue: Money }>;

export type FxError =
  | 'non_positive_amount'
  | 'currency_mismatch'
  | 'amount_mismatch'
  | 'rate_required'
  | 'invalid_rate'
  | 'out_of_range'
  | 'not_foreign_currency';

export function bookPosition(balance: Money, bookValue: Money): BookPosition {
  if (balance.currency === bookValue.currency && balance.amountMinor !== bookValue.amountMinor) {
    throw new RangeError('A base-currency account must have book value equal to its balance');
  }
  return Object.freeze({ balance, bookValue });
}

function isForeign(position: BookPosition): boolean {
  return position.balance.currency !== position.bookValue.currency;
}

function atRate(amount: Money, base: CurrencyCode, rate: string | undefined): Result<Money, FxError> {
  if (rate === undefined) return err('rate_required');
  return convert(amount, rate, base);
}

function inRange(amountMinor: bigint, currency: CurrencyCode): Result<Money, FxError> {
  return isWithinRange(amountMinor) ? ok(money(amountMinor, currency)) : err('out_of_range');
}

/**
 * Book value of money entering an account from outside the user's accounts
 * (income, opening balance, positive adjustment). Foreign currency is valued at
 * the rate the user confirmed (target units per 1 source unit).
 */
export function valueIncoming(amount: Money, base: CurrencyCode, rate?: string): Result<Money, FxError> {
  if (amount.amountMinor <= 0n) return err('non_positive_amount');
  if (amount.currency === base) return ok(amount);
  return atRate(amount, base, rate);
}

/**
 * Book value of money leaving an account (expense, transfer out, negative adjustment),
 * as a positive base amount. Up to the positive balance it uses the moving average
 * (whole balance → whole book value, so nothing is left behind). Any excess (overdraft)
 * is valued at the confirmed rate.
 */
export function valueOutgoing(position: BookPosition, amount: Money, rate?: string): Result<Money, FxError> {
  if (amount.amountMinor <= 0n) return err('non_positive_amount');
  if (amount.currency !== position.balance.currency) return err('currency_mismatch');

  const base = position.bookValue.currency;
  if (!isForeign(position)) return ok(money(amount.amountMinor, base));

  const available = position.balance.amountMinor > 0n ? position.balance.amountMinor : 0n;
  const covered = amount.amountMinor < available ? amount.amountMinor : available;
  const book = position.bookValue.amountMinor;

  let fromAverage = 0n;
  if (covered > 0n) fromAverage = covered === available ? book : divideHalfEven(book * covered, available);

  let fromRate = 0n;
  const excess = amount.amountMinor - covered;
  if (excess > 0n) {
    const valued = atRate(money(excess, amount.currency), base, rate);
    if (!valued.ok) return valued;
    fromRate = valued.value.amountMinor;
  }

  return inRange(fromAverage + fromRate, base);
}

export type TransferValuation = Readonly<{
  /** Book value leaving the source account. */
  baseOut: Money;
  /** Book value arriving at the destination account. */
  baseIn: Money;
  /** baseIn − baseOut: realised FX result, booked to Unallocated when both accounts are budgeted. */
  fxResult: Money;
}>;

/**
 * Values an internal transfer. The book value moves with the money, except that a
 * base-currency destination must hold exactly what it received; the difference is
 * the realised FX result. Which envelope lines follow depends on budget membership
 * and is decided by the ledger layer (DATABASE.md §5a R3).
 */
export function valueTransfer(
  from: BookPosition,
  sent: Money,
  received: Money,
  rate?: string,
): Result<TransferValuation, FxError> {
  if (sent.amountMinor <= 0n || received.amountMinor <= 0n) return err('non_positive_amount');
  if (sent.currency !== from.balance.currency) return err('currency_mismatch');
  if (sent.currency === received.currency && sent.amountMinor !== received.amountMinor) return err('amount_mismatch');

  const baseOut = valueOutgoing(from, sent, rate);
  if (!baseOut.ok) return baseOut;

  const base = from.bookValue.currency;
  const baseIn = received.currency === base ? received : baseOut.value;
  const fxResult = inRange(baseIn.amountMinor - baseOut.value.amountMinor, base);
  if (!fxResult.ok) return fxResult;

  return ok(Object.freeze({ baseOut: baseOut.value, baseIn, fxResult: fxResult.value }));
}

export type Revaluation = Readonly<{ target: Money; delta: Money }>;

/**
 * Manual FX revaluation of a foreign-currency account (R4): the book value that
 * matches `rate`, and the delta booked to Unallocated.
 */
export function revalue(position: BookPosition, rate: string): Result<Revaluation, FxError> {
  if (!isForeign(position)) return err('not_foreign_currency');
  const base = position.bookValue.currency;

  const target = convert(position.balance, rate, base);
  if (!target.ok) return target;

  const delta = inRange(target.value.amountMinor - position.bookValue.amountMinor, base);
  if (!delta.ok) return delta;

  return ok(Object.freeze({ target: target.value, delta: delta.value }));
}
