import type { BudgetEnvelope } from '../allocation/income';
import type { BookPosition } from '../fx/book-value';
import type { CurrencyCode } from '../money/currency';
import type { Money } from '../money/money';

/** Matches the `entry_kind` enum in DATABASE.md. */
export type EntryKind =
  | 'opening_balance'
  | 'income'
  | 'expense'
  | 'transfer'
  | 'allocation'
  | 'adjustment'
  | 'fx_revaluation'
  | 'reversal';

/** Hidden per-user, per-currency counterparty accounts that keep entries zero-sum. */
export type SystemRole = 'income' | 'expense' | 'opening_balance' | 'fx_clearing' | 'adjustment';

/** A system account is identified by role + the line's currency. */
export type LedgerAccountRef<A extends string> =
  | Readonly<{ type: 'user'; accountId: A }>
  | Readonly<{ type: 'system'; role: SystemRole }>;

/** Mirrors `ledger_lines`: signed amount in the account currency, book value in the base currency (null on system lines). */
export type LedgerLine<A extends string> = Readonly<{
  account: LedgerAccountRef<A>;
  amount: Money;
  base: Money | null;
}>;

/** Mirrors `envelope_lines`: signed, non-zero, in the budget base currency. */
export type EnvelopeLine<E extends string> = Readonly<{ envelopeId: E; amount: Money }>;

/**
 * The financial content of a ledger entry. Metadata (date, category, note,
 * idempotency key) is attached by the API layer.
 */
export type EntryDraft<A extends string, E extends string> = Readonly<{
  kind: EntryKind;
  lines: readonly LedgerLine<A>[];
  envelopeLines: readonly EnvelopeLine<E>[];
}>;

/** A user account as the builders need it: identity, budget membership and current position. */
export type UserAccount<A extends string> = Readonly<{
  id: A;
  inBudget: boolean;
  position: BookPosition;
}>;

export type BudgetContext<E extends string> = Readonly<{
  baseCurrency: CurrencyCode;
  envelopes: readonly BudgetEnvelope<E>[];
}>;
