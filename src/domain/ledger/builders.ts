import {
  autoAllocateIncome,
  manualAllocateIncome,
  type AutoAllocationError,
  type ManualAllocationError,
  type ManualPart,
} from '../allocation/income';
import { revalue, valueIncoming, valueOutgoing, valueTransfer, type FxError } from '../fx/book-value';
import { isWithinRange, money, negate, type Money } from '../money/money';
import { err, ok, type Result } from '../shared/result';
import type { BudgetContext, EntryDraft, EntryKind, EnvelopeLine, LedgerLine, SystemRole, UserAccount } from './types';

/**
 * Entry builders: turn a user intent into the exact lines the database stores,
 * following DATABASE.md §5a (R1–R6). The SQL RPCs implement the same rules; these
 * are used for previews and to test the rules in isolation.
 */

export type LedgerError =
  | FxError
  | AutoAllocationError
  | ManualAllocationError
  | 'zero_amount'
  | 'base_currency_mismatch'
  | 'missing_unallocated'
  | 'envelope_required'
  | 'unknown_envelope'
  | 'same_account'
  | 'same_envelope'
  | 'no_change';

type Built<A extends string, E extends string> = Result<EntryDraft<A, E>, LedgerError>;
type EnvelopeResult<E extends string> = Result<EnvelopeLine<E>[], LedgerError>;

/* ---------- helpers ---------- */

function draft<A extends string, E extends string>(
  kind: EntryKind,
  lines: LedgerLine<A>[],
  envelopeLines: EnvelopeLine<E>[],
): EntryDraft<A, E> {
  return Object.freeze({ kind, lines: Object.freeze(lines), envelopeLines: Object.freeze(envelopeLines) });
}

function userLine<A extends string>(account: UserAccount<A>, amount: Money, base: Money): LedgerLine<A> {
  return Object.freeze({ account: Object.freeze({ type: 'user' as const, accountId: account.id }), amount, base });
}

function systemLine<A extends string>(role: SystemRole, amount: Money): LedgerLine<A> {
  return Object.freeze({ account: Object.freeze({ type: 'system' as const, role }), amount, base: null });
}

/** Envelope lines must be non-zero, so a zero amount yields no line. */
function envelopeLine<E extends string>(envelopeId: E, amount: Money): EnvelopeLine<E>[] {
  return amount.amountMinor === 0n ? [] : [Object.freeze({ envelopeId, amount })];
}

function hasEnvelope<E extends string>(budget: BudgetContext<E>, id: E): boolean {
  return budget.envelopes.some((e) => e.id === id);
}

function toUnallocated<E extends string>(budget: BudgetContext<E>, amount: Money): EnvelopeResult<E> {
  if (amount.amountMinor === 0n) return ok([]);
  const unallocated = budget.envelopes.find((e) => e.kind === 'unallocated');
  if (unallocated === undefined) return err('missing_unallocated');
  return ok(envelopeLine(unallocated.id, amount));
}

function toEnvelope<E extends string>(budget: BudgetContext<E>, id: E | undefined, amount: Money): EnvelopeResult<E> {
  if (id === undefined) return toUnallocated(budget, amount);
  return hasEnvelope(budget, id) ? ok(envelopeLine(id, amount)) : err('unknown_envelope');
}

function checkAccount<A extends string, E extends string>(
  account: UserAccount<A>,
  budget: BudgetContext<E>,
  amount: Money,
): LedgerError | null {
  if (account.position.bookValue.currency !== budget.baseCurrency) return 'base_currency_mismatch';
  if (amount.currency !== account.position.balance.currency) return 'currency_mismatch';
  return null;
}

/* ---------- builders ---------- */

/** Opening balance (may be negative, e.g. a credit card). Budgeted accounts put it in Unallocated. */
export function buildOpeningBalance<A extends string, E extends string>(
  account: UserAccount<A>,
  amount: Money,
  budget: BudgetContext<E>,
  rate?: string,
): Built<A, E> {
  const invalid = checkAccount(account, budget, amount);
  if (invalid !== null) return err(invalid);
  if (amount.amountMinor === 0n) return err('zero_amount');

  const negative = amount.amountMinor < 0n;
  const valued = valueIncoming(negative ? negate(amount) : amount, budget.baseCurrency, rate);
  if (!valued.ok) return valued;
  const base = negative ? negate(valued.value) : valued.value;

  const envelopes = account.inBudget ? toUnallocated(budget, base) : ok([]);
  if (!envelopes.ok) return envelopes;

  return ok(
    draft(
      'opening_balance',
      [userLine(account, amount, base), systemLine('opening_balance', negate(amount))],
      envelopes.value,
    ),
  );
}

export type IncomeAllocation<E extends string> =
  | Readonly<{ mode: 'auto' }>
  | Readonly<{ mode: 'manual'; parts: readonly ManualPart<E>[] }>;

/** Income (PRD INC-1…4). Budgeted accounts split the base amount by method or by the user. */
export function buildIncome<A extends string, E extends string>(
  account: UserAccount<A>,
  amount: Money,
  budget: BudgetContext<E>,
  allocation: IncomeAllocation<E>,
  rate?: string,
): Built<A, E> {
  const invalid = checkAccount(account, budget, amount);
  if (invalid !== null) return err(invalid);

  const valued = valueIncoming(amount, budget.baseCurrency, rate);
  if (!valued.ok) return valued;
  const base = valued.value;

  let envelopes: EnvelopeLine<E>[] = [];
  if (account.inBudget && base.amountMinor > 0n) {
    const split =
      allocation.mode === 'auto'
        ? autoAllocateIncome(base, budget.envelopes)
        : manualAllocateIncome(base, budget.envelopes, allocation.parts);
    if (!split.ok) return split;
    envelopes = split.value.map((line) => Object.freeze({ envelopeId: line.envelopeId, amount: line.amount }));
  }

  return ok(draft('income', [userLine(account, amount, base), systemLine('income', negate(amount))], envelopes));
}

/** Expense (PRD EXP-1). Budgeted accounts need an envelope; the envelope loses the book value spent. */
export function buildExpense<A extends string, E extends string>(
  account: UserAccount<A>,
  amount: Money,
  envelopeId: E | null,
  budget: BudgetContext<E>,
  rate?: string,
): Built<A, E> {
  const invalid = checkAccount(account, budget, amount);
  if (invalid !== null) return err(invalid);
  if (account.inBudget) {
    if (envelopeId === null) return err('envelope_required');
    if (!hasEnvelope(budget, envelopeId)) return err('unknown_envelope');
  }

  const valued = valueOutgoing(account.position, amount, rate);
  if (!valued.ok) return valued;
  const base = negate(valued.value);

  const envelopes = account.inBudget && envelopeId !== null ? envelopeLine(envelopeId, base) : [];
  return ok(draft('expense', [userLine(account, negate(amount), base), systemLine('expense', amount)], envelopes));
}

export type TransferOptions<E extends string> = Readonly<{
  /** Envelope used when money crosses the budget boundary (default Unallocated). */
  envelopeId?: E;
  /** Confirmed rate, needed only for an overdraft on a foreign-currency source. */
  rate?: string;
}>;

/** Internal transfer, same or cross currency (PRD ACC-6, DATABASE R2/R3). */
export function buildTransfer<A extends string, E extends string>(
  from: UserAccount<A>,
  to: UserAccount<A>,
  sent: Money,
  received: Money,
  budget: BudgetContext<E>,
  options: TransferOptions<E> = {},
): Built<A, E> {
  const invalid = checkAccount(from, budget, sent) ?? checkAccount(to, budget, received);
  if (invalid !== null) return err(invalid);
  if (from.id === to.id) return err('same_account');

  const valuation = valueTransfer(from.position, sent, received, options.rate);
  if (!valuation.ok) return valuation;
  const { baseOut, baseIn, fxResult } = valuation.value;

  const lines = [userLine(from, negate(sent), negate(baseOut)), userLine(to, received, baseIn)];
  if (sent.currency !== received.currency) {
    lines.push(systemLine('fx_clearing', sent), systemLine('fx_clearing', negate(received)));
  }

  let envelopes: EnvelopeResult<E>;
  if (from.inBudget && to.inBudget) envelopes = toUnallocated(budget, fxResult);
  else if (from.inBudget) envelopes = toEnvelope(budget, options.envelopeId, negate(baseOut));
  else if (to.inBudget) envelopes = toEnvelope(budget, options.envelopeId, baseIn);
  else envelopes = ok([]);
  if (!envelopes.ok) return envelopes;

  return ok(draft('transfer', lines, envelopes.value));
}

/** Moves budget between two envelopes (no money moves). */
export function buildReallocation<A extends string, E extends string>(
  fromEnvelope: E,
  toEnvelope: E,
  amount: Money,
  budget: BudgetContext<E>,
): Built<A, E> {
  if (amount.currency !== budget.baseCurrency) return err('currency_mismatch');
  if (amount.amountMinor <= 0n) return err('non_positive_amount');
  if (fromEnvelope === toEnvelope) return err('same_envelope');
  if (!hasEnvelope(budget, fromEnvelope) || !hasEnvelope(budget, toEnvelope)) return err('unknown_envelope');

  return ok(
    draft<A, E>(
      'allocation',
      [],
      [...envelopeLine(fromEnvelope, negate(amount)), ...envelopeLine(toEnvelope, amount)],
    ),
  );
}

/** Reconciliation to a target balance (PRD ACC-7). The difference goes to Unallocated. */
export function buildAdjustment<A extends string, E extends string>(
  account: UserAccount<A>,
  targetBalance: Money,
  budget: BudgetContext<E>,
  rate?: string,
): Built<A, E> {
  const invalid = checkAccount(account, budget, targetBalance);
  if (invalid !== null) return err(invalid);

  const diffMinor = targetBalance.amountMinor - account.position.balance.amountMinor;
  if (diffMinor === 0n) return err('no_change');
  if (!isWithinRange(diffMinor)) return err('out_of_range');
  const diff = money(diffMinor, targetBalance.currency);

  const valued =
    diffMinor > 0n
      ? valueIncoming(diff, budget.baseCurrency, rate)
      : valueOutgoing(account.position, negate(diff), rate);
  if (!valued.ok) return valued;
  const base = diffMinor > 0n ? valued.value : negate(valued.value);

  const envelopes = account.inBudget ? toUnallocated(budget, base) : ok([]);
  if (!envelopes.ok) return envelopes;

  return ok(draft('adjustment', [userLine(account, diff, base), systemLine('adjustment', negate(diff))], envelopes.value));
}

/** Manual FX revaluation (R4): a zero-amount line carrying the book-value delta. */
export function buildRevaluation<A extends string, E extends string>(
  account: UserAccount<A>,
  rate: string,
  budget: BudgetContext<E>,
): Built<A, E> {
  const invalid = checkAccount(account, budget, account.position.balance);
  if (invalid !== null) return err(invalid);

  const revaluation = revalue(account.position, rate);
  if (!revaluation.ok) return revaluation;
  const { delta } = revaluation.value;
  if (delta.amountMinor === 0n) return err('no_change');

  const envelopes = account.inBudget ? toUnallocated(budget, delta) : ok([]);
  if (!envelopes.ok) return envelopes;

  const zero = money(0n, account.position.balance.currency);
  return ok(draft('fx_revaluation', [userLine(account, zero, delta)], envelopes.value));
}

/** Reversal (R5): negates every line of the original. The DB enforces "at most one reversal per entry". */
export function buildReversal<A extends string, E extends string>(
  entry: EntryDraft<A, E>,
): Result<EntryDraft<A, E>, 'cannot_reverse_reversal'> {
  if (entry.kind === 'reversal') return err('cannot_reverse_reversal');
  const lines = entry.lines.map((line) =>
    Object.freeze({ account: line.account, amount: negate(line.amount), base: line.base === null ? null : negate(line.base) }),
  );
  const envelopes = entry.envelopeLines.map((line) =>
    Object.freeze({ envelopeId: line.envelopeId, amount: negate(line.amount) }),
  );
  return ok(draft('reversal', lines, envelopes));
}
