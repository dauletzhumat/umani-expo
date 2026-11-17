import type { CurrencyCode } from './currency';

/**
 * An exact amount of money: integer minor units (tiyn, cents, kopecks, fen)
 * plus its currency. Never a float (CLAUDE.md rule 1).
 */
export type Money = Readonly<{
  amountMinor: bigint;
  currency: CurrencyCode;
}>;

/** Largest absolute amount accepted anywhere (matches the RPC validation, ≤ 10^15). */
export const MAX_ABS_MINOR = 10n ** 15n;

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function isWithinRange(amountMinor: bigint): boolean {
  return amountMinor <= MAX_ABS_MINOR && amountMinor >= -MAX_ABS_MINOR;
}

/** Creates a Money value. Throws RangeError beyond ±MAX_ABS_MINOR (programmer error). */
export function money(amountMinor: bigint, currency: CurrencyCode): Money {
  if (!isWithinRange(amountMinor)) {
    throw new RangeError(`Amount out of range: ${amountMinor.toString()}`);
  }
  return Object.freeze({ amountMinor, currency });
}

export function zero(currency: CurrencyCode): Money {
  return money(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function isPositive(a: Money): boolean {
  return a.amountMinor > 0n;
}

export function isNegative(a: Money): boolean {
  return a.amountMinor < 0n;
}
