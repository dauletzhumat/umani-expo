import type { CurrencyCode } from '../money/currency';
import { err, ok, type Result } from '../shared/result';
import type { EntryDraft } from './types';

/** Per-entry invariants enforced again by triggers in the database (DATABASE.md §3, §7). */
export type EntryInvariantError =
  | { readonly code: 'empty_entry' }
  | { readonly code: 'zero_line'; readonly index: number }
  | { readonly code: 'base_missing'; readonly index: number }
  | { readonly code: 'base_on_system_line'; readonly index: number }
  | { readonly code: 'base_currency_mismatch'; readonly index: number }
  | { readonly code: 'unbalanced'; readonly currency: CurrencyCode; readonly sum: bigint }
  | { readonly code: 'zero_envelope_line'; readonly index: number }
  | { readonly code: 'envelope_currency_mismatch'; readonly index: number }
  | { readonly code: 'allocation_unbalanced' };

/**
 * Checks one entry:
 * - L1: ledger lines sum to zero per currency;
 * - line shape: non-zero amounts (except revaluations and reversals), user lines carry a base amount in the
 *   base currency, system lines carry none;
 * - envelope lines are non-zero and in the base currency;
 * - E1: allocation entries' envelope lines sum to zero.
 */
export function checkEntry<A extends string, E extends string>(
  entry: EntryDraft<A, E>,
  baseCurrency: CurrencyCode,
): Result<void, EntryInvariantError> {
  if (entry.lines.length === 0 && entry.envelopeLines.length === 0) return err({ code: 'empty_entry' });

  const sums = new Map<CurrencyCode, bigint>();
  for (const [index, line] of entry.lines.entries()) {
    // Revaluation lines have amount 0 (only the book value changes), and so do their reversals.
    if (line.amount.amountMinor === 0n && entry.kind !== 'fx_revaluation' && entry.kind !== 'reversal') {
      return err({ code: 'zero_line', index });
    }
    if (line.account.type === 'user') {
      if (line.base === null) return err({ code: 'base_missing', index });
      if (line.base.currency !== baseCurrency) return err({ code: 'base_currency_mismatch', index });
    } else if (line.base !== null) {
      return err({ code: 'base_on_system_line', index });
    }
    sums.set(line.amount.currency, (sums.get(line.amount.currency) ?? 0n) + line.amount.amountMinor);
  }
  for (const [currency, sum] of sums) {
    if (sum !== 0n) return err({ code: 'unbalanced', currency, sum });
  }

  let envelopeSum = 0n;
  for (const [index, line] of entry.envelopeLines.entries()) {
    if (line.amount.amountMinor === 0n) return err({ code: 'zero_envelope_line', index });
    if (line.amount.currency !== baseCurrency) return err({ code: 'envelope_currency_mismatch', index });
    envelopeSum += line.amount.amountMinor;
  }
  if (entry.kind === 'allocation' && envelopeSum !== 0n) return err({ code: 'allocation_unbalanced' });

  return ok(undefined);
}
