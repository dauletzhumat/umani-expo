import { z } from 'zod';

import { bookPosition, valueOutgoing } from '@/domain/fx/book-value';
import { parseRate } from '@/domain/money/convert';
import { isCurrencyCode, type CurrencyCode } from '@/domain/money/currency';
import { add, subtract, type Money } from '@/domain/money/money';
import { fromWire } from '@/domain/money/wire';
import type { Database } from '@/lib/supabase/database.types';

type DbEntryKind = Database['public']['Enums']['entry_kind'];

// ---------- names ----------

/** i18n keys the database uses for preset envelopes. */
export const ENVELOPE_NAME_KEYS = [
  'envelope.needs',
  'envelope.wants',
  'envelope.savings',
  'envelope.spending',
  'envelope.living',
  'envelope.debtGiving',
  'envelope.unallocated',
] as const;
export type EnvelopeNameKey = (typeof ENVELOPE_NAME_KEYS)[number];
export const isEnvelopeNameKey = (key: string | null): key is EnvelopeNameKey =>
  (ENVELOPE_NAME_KEYS as readonly (string | null)[]).includes(key);

/** i18n keys of the default categories seeded at onboarding (api.setup_budget). */
export const CATEGORY_NAME_KEYS = [
  'category.groceries',
  'category.transport',
  'category.housing',
  'category.utilities',
  'category.health',
  'category.restaurants',
  'category.entertainment',
  'category.shopping',
  'category.education',
  'category.otherExpense',
  'category.salary',
  'category.freelance',
  'category.gift',
  'category.otherIncome',
] as const;
export type CategoryNameKey = (typeof CATEGORY_NAME_KEYS)[number];
export const isCategoryNameKey = (key: string | null): key is CategoryNameKey =>
  (CATEGORY_NAME_KEYS as readonly (string | null)[]).includes(key);

// ---------- categories ----------

export type CategoryKind = 'income' | 'expense';

export type Category = Readonly<{
  id: string;
  kind: CategoryKind;
  /** User-given name; default categories use nameKey until the user renames them. */
  name: string | null;
  nameKey: string | null;
  defaultEnvelopeId: string | null;
}>;

export const CategoryRowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['income', 'expense']),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  default_envelope_id: z.uuid().nullable(),
});

export function toCategory(row: z.infer<typeof CategoryRowSchema>): Category {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    nameKey: row.name_key,
    defaultEnvelopeId: row.default_envelope_id,
  };
}

/** Defaults in the template order (they share one created_at), then the user's own as created. */
export function sortCategories(categories: readonly Category[]): Category[] {
  const rank = (c: Category) => {
    const index = (CATEGORY_NAME_KEYS as readonly (string | null)[]).indexOf(c.nameKey);
    return index === -1 ? CATEGORY_NAME_KEYS.length : index;
  };
  return categories
    .map((category, order) => ({ category, order }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.order - b.order)
    .map((x) => x.category);
}

/**
 * Which preset envelope kinds a default category usually comes out of, best match first, so quick
 * entry stays at three taps until the user sets a default envelope of their own.
 */
const SUGGESTED_KINDS: Partial<Record<CategoryNameKey, readonly string[]>> = {
  'category.groceries': ['needs', 'living'],
  'category.transport': ['needs', 'living'],
  'category.housing': ['needs', 'living'],
  'category.utilities': ['needs', 'living'],
  'category.health': ['needs', 'living'],
  'category.education': ['needs', 'living'],
  'category.restaurants': ['wants', 'spending'],
  'category.entertainment': ['wants', 'spending'],
  'category.shopping': ['wants', 'spending'],
};

/** The category's own default envelope, else a preset envelope its kind suggests, else null. */
export function defaultEnvelopeFor(
  category: Category | undefined,
  envelopes: readonly Pick<SpendEnvelope, 'id' | 'kind'>[],
): string | null {
  if (category === undefined) return null;
  if (category.defaultEnvelopeId !== null && envelopes.some((e) => e.id === category.defaultEnvelopeId)) {
    return category.defaultEnvelopeId;
  }
  if (category.name !== null || !isCategoryNameKey(category.nameKey)) return null;
  for (const kind of SUGGESTED_KINDS[category.nameKey] ?? []) {
    const match = envelopes.find((e) => e.kind === kind);
    if (match !== undefined) return match.id;
  }
  return null;
}

// ---------- envelopes and accounts as the expense screens need them ----------

export type SpendEnvelope = Readonly<{
  id: string;
  name: string | null;
  nameKey: string | null;
  kind: string;
  balance: Money;
}>;

export const EnvelopeRowSchema = z.object({
  envelope_id: z.uuid(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  kind: z.string(),
  balance_minor: z.string().nullable(),
});

export function toSpendEnvelope(row: z.infer<typeof EnvelopeRowSchema>, base: CurrencyCode): SpendEnvelope | null {
  const balance = fromWire(row.balance_minor ?? '0', base);
  if (!balance.ok) return null;
  return { id: row.envelope_id, name: row.name, nameKey: row.name_key, kind: row.kind, balance: balance.value };
}

/** An account as the expense screens need it (passed in by routes from the accounts feature). */
export type ExpenseAccount = Readonly<{
  id: string;
  name: string;
  currency: CurrencyCode;
  includeInBudget: boolean;
  /** Balance in the account currency. */
  balance: Money;
  /** Book value in the base currency (DATABASE §5a R2). */
  bookValue: Money;
}>;

/**
 * What an expense takes out of the envelope, in base currency, as api.record_expense will compute
 * it (moving average, then the rate for any overdraft — private.book_out). Null when it can't be
 * known yet (no rate for an overdraft, invalid amount).
 */
export function estimateBaseCost(account: ExpenseAccount, amount: Money, rate?: string): Money | null {
  const valued = valueOutgoing(bookPosition(account.balance, account.bookValue), amount, rate);
  return valued.ok ? valued.value : null;
}

/**
 * The account as api.amend_entry sees it: the original expense is reversed before the new one is
 * posted, so its amount is back on the account. The book value of that refund is only known for
 * base-currency accounts (book = balance); for a foreign account `bookKnown` is false.
 */
export function accountForEdit(
  account: ExpenseAccount,
  original: Pick<HistoryItem, 'accountId' | 'amount'> | undefined,
): Readonly<{ account: ExpenseAccount; bookKnown: boolean }> {
  if (original === undefined || original.accountId !== account.id || original.amount.currency !== account.currency) {
    return { account, bookKnown: true };
  }
  const balance = subtract(account.balance, original.amount); // the history amount is negative
  if (account.currency === account.bookValue.currency) {
    return { account: { ...account, balance, bookValue: balance }, bookKnown: true };
  }
  return { account: { ...account, balance }, bookKnown: false };
}

/**
 * The envelope balance after saving: minus the cost, plus what the reversed original returns to
 * the same envelope (editing). Null when the cost isn't known.
 */
export function projectedEnvelopeBalance(
  envelope: Pick<SpendEnvelope, 'balance'>,
  cost: Money | null,
  refund: Money | null,
): Money | null {
  if (cost === null) return null;
  const after = subtract(envelope.balance, cost);
  return refund === null ? after : add(after, refund);
}

/** A foreign expense larger than the positive balance needs the user's rate (book_out). */
export function needsRate(account: ExpenseAccount, amount: Money | null, base: CurrencyCode): boolean {
  if (account.currency === base || amount === null) return false;
  const available = account.balance.amountMinor > 0n ? account.balance.amountMinor : 0n;
  return amount.amountMinor > available;
}

// ---------- history (EXP-5) ----------

/** Mirrors public.entry_kind; `satisfies` + the exhaustiveness check below keep it in sync with the DB types. */
export const ENTRY_KINDS = [
  'opening_balance',
  'income',
  'expense',
  'transfer',
  'allocation',
  'adjustment',
  'fx_revaluation',
  'reversal',
] as const satisfies readonly DbEntryKind[];
export type EntryKind = (typeof ENTRY_KINDS)[number];
type MissingKinds = Exclude<DbEntryKind, EntryKind>;
const allKindsCovered: MissingKinds extends never ? true : never = true;
void allKindsCovered;

export const HistoryRowSchema = z.object({
  entry_id: z.uuid(),
  kind: z.enum(ENTRY_KINDS),
  occurred_on: z.string(),
  category_id: z.uuid().nullable(),
  note: z.string().nullable(),
  account_id: z.uuid(),
  currency: z.string(),
  amount_minor: z.string(),
  envelope_id: z.uuid().nullable(),
});
export type HistoryRow = z.infer<typeof HistoryRowSchema>;

export type HistoryItem = Readonly<{
  /** entry and account: a transfer is listed once per account it touched. */
  key: string;
  entryId: string;
  kind: EntryKind;
  occurredOn: string;
  categoryId: string | null;
  note: string | null;
  accountId: string;
  /** Signed, in the account currency: money in is positive. */
  amount: Money;
  envelopeId: string | null;
}>;

/** Rows the app can read; malformed ones (unknown currency, bad amount) are skipped. */
export function toHistory(rows: readonly HistoryRow[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const row of rows) {
    if (!isCurrencyCode(row.currency)) continue;
    const amount = fromWire(row.amount_minor, row.currency);
    if (!amount.ok) continue;
    items.push({
      key: `${row.entry_id}:${row.account_id}`,
      entryId: row.entry_id,
      kind: row.kind,
      occurredOn: row.occurred_on,
      categoryId: row.category_id,
      note: row.note,
      accountId: row.account_id,
      amount: amount.value,
      envelopeId: row.envelope_id,
    });
  }
  return items;
}

// ---------- limits (EXP-4) ----------

export type LimitState = 'ok' | 'near' | 'over';

export type LimitProgress = Readonly<{
  limitId: string;
  envelopeId: string | null;
  categoryId: string | null;
  limit: Money;
  spent: Money;
  state: LimitState;
  /** 0…1000, for the progress bar only (never used as money). */
  permille: number;
}>;

export const LimitProgressRowSchema = z.object({
  limit_id: z.uuid(),
  envelope_id: z.uuid().nullable(),
  category_id: z.uuid().nullable(),
  limit_minor: z.string(),
  spent_minor: z.string(),
});

/** "near" from 80% of the limit; "over" once spending is above it. */
export const NEAR_LIMIT_PERCENT = 80n;

export function toLimitProgress(row: z.infer<typeof LimitProgressRowSchema>, base: CurrencyCode): LimitProgress | null {
  const limit = fromWire(row.limit_minor, base);
  const spent = fromWire(row.spent_minor, base);
  if (!limit.ok || !spent.ok || limit.value.amountMinor <= 0n) return null;
  const l = limit.value.amountMinor;
  const s = spent.value.amountMinor > 0n ? spent.value.amountMinor : 0n;
  const state: LimitState = s > l ? 'over' : s * 100n >= l * NEAR_LIMIT_PERCENT ? 'near' : 'ok';
  return {
    limitId: row.limit_id,
    envelopeId: row.envelope_id,
    categoryId: row.category_id,
    limit: limit.value,
    spent: spent.value,
    state,
    permille: Number(s >= l ? 1000n : (s * 1000n) / l),
  };
}

// ---------- errors, dates, rates ----------

/** RPC error codes the expense screens explain; anything else is a generic failure. */
export const EXPENSE_ERRORS = [
  'rate_required',
  'invalid_rate',
  'non_positive_amount',
  'envelope_required',
  'unknown_envelope',
  'unknown_category',
  'unknown_limit',
  'account_archived',
  'already_reversed',
  'duplicate_name',
  'invalid_name',
  'category_limit',
  'limit_limit',
  'idempotency_conflict',
  'out_of_range',
  'invalid_amount',
] as const;
export type ExpenseError = (typeof EXPENSE_ERRORS)[number] | 'failed';

export function toExpenseError(message: string | undefined): ExpenseError {
  return (EXPENSE_ERRORS as readonly string[]).includes(message ?? '') ? (message as ExpenseError) : 'failed';
}

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "2026-11-19" → "2026-11-01". */
export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** "2026-11-19" → "19.11.2026". */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year === undefined || month === undefined || day === undefined ? isoDate : `${day}.${month}.${year}`;
}

/** "475,5" → "475.5" if it is a valid positive rate. */
export function rateFromInput(input: string): string | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  return parseRate(normalized).ok ? normalized : null;
}
