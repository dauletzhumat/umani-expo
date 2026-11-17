import { bookPosition } from '../fx/book-value';
import type { CurrencyCode } from '../money/currency';
import { money } from '../money/money';
import { err, ok, type Result } from '../shared/result';
import type { EntryDraft, UserAccount } from './types';

/**
 * In-memory ledger state derived from entries: account balances, book values and
 * envelope balances. Used for optimistic previews and to check R1 in tests. The
 * database derives the same numbers from its views.
 */

export type AccountState = Readonly<{
  currency: CurrencyCode;
  inBudget: boolean;
  balance: bigint;
  bookValue: bigint;
}>;

export type LedgerState<A extends string, E extends string> = Readonly<{
  baseCurrency: CurrencyCode;
  accounts: ReadonlyMap<A, AccountState>;
  envelopes: ReadonlyMap<E, bigint>;
}>;

export type AccountSetup<A extends string> = Readonly<{ id: A; currency: CurrencyCode; inBudget: boolean }>;

export function emptyLedger<A extends string, E extends string>(
  baseCurrency: CurrencyCode,
  accounts: readonly AccountSetup<A>[],
  envelopeIds: readonly E[],
): LedgerState<A, E> {
  return Object.freeze({
    baseCurrency,
    accounts: new Map(
      accounts.map((a) => [a.id, Object.freeze({ currency: a.currency, inBudget: a.inBudget, balance: 0n, bookValue: 0n })]),
    ),
    envelopes: new Map(envelopeIds.map((id) => [id, 0n])),
  });
}

/** Returns a new state with the entry applied. Unknown accounts or envelopes are programmer errors and throw. */
export function applyEntry<A extends string, E extends string>(
  state: LedgerState<A, E>,
  entry: EntryDraft<A, E>,
): LedgerState<A, E> {
  const accounts = new Map(state.accounts);
  for (const line of entry.lines) {
    if (line.account.type !== 'user') continue;
    const current = accounts.get(line.account.accountId);
    if (current === undefined) throw new Error(`Unknown account: ${line.account.accountId}`);
    accounts.set(
      line.account.accountId,
      Object.freeze({
        ...current,
        balance: current.balance + line.amount.amountMinor,
        bookValue: current.bookValue + (line.base?.amountMinor ?? 0n),
      }),
    );
  }

  const envelopes = new Map(state.envelopes);
  for (const line of entry.envelopeLines) {
    const current = envelopes.get(line.envelopeId);
    if (current === undefined) throw new Error(`Unknown envelope: ${line.envelopeId}`);
    envelopes.set(line.envelopeId, current + line.amount.amountMinor);
  }

  return Object.freeze({ baseCurrency: state.baseCurrency, accounts, envelopes });
}

/** The builder input for an account in this state. */
export function userAccount<A extends string, E extends string>(state: LedgerState<A, E>, id: A): UserAccount<A> {
  const account = state.accounts.get(id);
  if (account === undefined) throw new Error(`Unknown account: ${id}`);
  return Object.freeze({
    id,
    inBudget: account.inBudget,
    position: bookPosition(money(account.balance, account.currency), money(account.bookValue, state.baseCurrency)),
  });
}

export type ReconciliationError<A extends string> =
  | { readonly code: 'base_account_drift'; readonly accountId: A }
  | { readonly code: 'r1_violation'; readonly envelopes: bigint; readonly bookValue: bigint };

/**
 * R1: Σ envelope balances = Σ book value of budgeted accounts; and every account in the
 * base currency has book value = balance.
 */
export function checkReconciliation<A extends string, E extends string>(
  state: LedgerState<A, E>,
): Result<void, ReconciliationError<A>> {
  let bookValue = 0n;
  for (const [accountId, account] of state.accounts) {
    if (account.currency === state.baseCurrency && account.balance !== account.bookValue) {
      return err({ code: 'base_account_drift', accountId });
    }
    if (account.inBudget) bookValue += account.bookValue;
  }

  let envelopes = 0n;
  for (const balance of state.envelopes.values()) envelopes += balance;

  if (envelopes !== bookValue) return err({ code: 'r1_violation', envelopes, bookValue });
  return ok(undefined);
}
