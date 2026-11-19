import { z } from 'zod';

import type { EnvelopeKind } from '@/domain/allocation/envelope';
import type { BudgetEnvelope } from '@/domain/allocation/income';
import { isCurrencyCode, type CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { fromWire } from '@/domain/money/wire';

export const ENVELOPE_KINDS = [
  'needs',
  'wants',
  'savings',
  'spending',
  'living',
  'debt_giving',
  'custom',
  'unallocated',
] as const satisfies readonly EnvelopeKind[];

export type Envelope = Readonly<{
  id: string;
  /** User-given name (custom envelopes); presets use nameKey instead. */
  name: string | null;
  nameKey: string | null;
  kind: EnvelopeKind;
  allocationBps: number;
  sortOrder: number;
  balance: Money;
}>;

export const EnvelopeRowSchema = z.object({
  envelope_id: z.uuid(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  kind: z.enum(ENVELOPE_KINDS),
  allocation_bps: z.number().int(),
  sort_order: z.number().int(),
  balance_minor: z.string().nullable(),
});
export type EnvelopeRow = z.infer<typeof EnvelopeRowSchema>;

export function toEnvelope(row: EnvelopeRow, base: CurrencyCode): Envelope | null {
  const balance = fromWire(row.balance_minor ?? '0', base);
  if (!balance.ok) return null;
  return Object.freeze({
    id: row.envelope_id,
    name: row.name,
    nameKey: row.name_key,
    kind: row.kind,
    allocationBps: row.allocation_bps,
    sortOrder: row.sort_order,
    balance: balance.value,
  });
}

/** The envelopes the allocation logic works on (domain shape). */
export function toBudgetEnvelopes(envelopes: readonly Envelope[]): BudgetEnvelope<string>[] {
  return envelopes.map((e) => ({ id: e.id, kind: e.kind, allocationBps: e.allocationBps, sortOrder: e.sortOrder }));
}

/** i18n keys the database uses for preset envelopes and default categories. */
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

export const INCOME_CATEGORY_KEYS = [
  'category.salary',
  'category.freelance',
  'category.gift',
  'category.otherIncome',
] as const;
export type IncomeCategoryKey = (typeof INCOME_CATEGORY_KEYS)[number];
export const isIncomeCategoryKey = (key: string | null): key is IncomeCategoryKey =>
  (INCOME_CATEGORY_KEYS as readonly (string | null)[]).includes(key);

export type Category = Readonly<{ id: string; name: string | null; nameKey: string | null }>;

export const CategoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
});

/** A recorded income (reportable: neither reversed nor a reversal), for the edit list (INC-5). */
export type IncomeEntry = Readonly<{
  id: string;
  occurredOn: string;
  note: string | null;
  categoryId: string | null;
  accountId: string;
  amount: Money;
}>;

export const IncomeEntryRowSchema = z.object({
  id: z.uuid(),
  occurred_on: z.string(),
  note: z.string().nullable(),
  category_id: z.uuid().nullable(),
});

export const IncomeLineRowSchema = z.object({
  entry_id: z.uuid(),
  account_id: z.uuid(),
  currency: z.string(),
  amount: z.string(),
});
export type IncomeLineRow = z.infer<typeof IncomeLineRowSchema>;

/**
 * Joins income entries with their user-account line (the positive line; the other side is the
 * hidden system income account). Entries without a readable line are skipped.
 */
export function toIncomeEntries(
  entries: readonly z.infer<typeof IncomeEntryRowSchema>[],
  lines: readonly IncomeLineRow[],
  userAccountIds: ReadonlySet<string>,
): IncomeEntry[] {
  const result: IncomeEntry[] = [];
  for (const entry of entries) {
    const line = lines.find((l) => l.entry_id === entry.id && userAccountIds.has(l.account_id));
    if (line === undefined || !isCurrencyCode(line.currency)) continue;
    const amount = fromWire(line.amount, line.currency);
    if (!amount.ok) continue;
    result.push({
      id: entry.id,
      occurredOn: entry.occurred_on,
      note: entry.note,
      categoryId: entry.category_id,
      accountId: line.account_id,
      amount: amount.value,
    });
  }
  return result;
}

/** RPC error codes the budget screens explain; anything else is a generic failure. */
export const BUDGET_ERRORS = [
  'rate_required',
  'invalid_rate',
  'non_positive_amount',
  'exceeds_total',
  'negative_part',
  'same_envelope',
  'account_archived',
  'already_reversed',
  'not_100_percent',
  'duplicate_name',
  'invalid_name',
  'too_many_envelopes',
  'idempotency_conflict',
  'out_of_range',
  'invalid_reassign',
  'invalid_percentage',
  'invalid_custom_budget',
  'too_few_envelopes',
  'unknown_envelope',
] as const;
export type BudgetError = (typeof BUDGET_ERRORS)[number] | 'failed';

export function toBudgetError(message: string | undefined): BudgetError {
  return (BUDGET_ERRORS as readonly string[]).includes(message ?? '') ? (message as BudgetError) : 'failed';
}

/** "2026-11-19" → "19.11.2026". */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year === undefined || month === undefined || day === undefined ? isoDate : `${day}.${month}.${year}`;
}

/** Basis points as a percentage label: 5000 → "50", 3333 → "33.33" (ru/kk: "33,33"). */
export function bpsLabel(bps: number, locale: 'ru' | 'kk' | 'en'): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  const text = `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
  return locale === 'en' ? text : text.replace('.', ',');
}

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** An account as the budget screens need it (passed in by routes from the accounts feature). */
export type AccountOption = Readonly<{
  id: string;
  name: string;
  currency: CurrencyCode;
  includeInBudget: boolean;
}>;

export type LayoutSlot = Readonly<{ name: string | null; nameKey: string | null; keepId: string | null }>;
export type SwitchPlan = Readonly<{ layout: readonly LayoutSlot[]; removed: readonly Envelope[] }>;

/**
 * Mirrors api.change_budget_method's matching so the screen can preview it: a preset keeps the
 * first active envelope of each of its kinds; a custom layout keeps the envelopes its rows name.
 * Everything else (except Unallocated) is removed and its balance needs a target.
 */
export function planMethodSwitch(
  current: readonly Envelope[],
  presetSlots: readonly Readonly<{ kind: EnvelopeKind; nameKey: string }>[] | null,
  customRows: readonly Readonly<{ name: string; envelopeId?: string }>[],
): SwitchPlan {
  const candidates = [...current.filter((e) => e.kind !== 'unallocated')].sort((a, b) => a.sortOrder - b.sortOrder);
  const kept = new Set<string>();
  const layout: LayoutSlot[] = [];
  if (presetSlots !== null) {
    for (const slot of presetSlots) {
      const match = candidates.find((e) => e.kind === slot.kind && !kept.has(e.id));
      if (match !== undefined) kept.add(match.id);
      layout.push({ name: null, nameKey: slot.nameKey, keepId: match?.id ?? null });
    }
  } else {
    for (const row of customRows) {
      const keepId = row.envelopeId !== undefined && candidates.some((e) => e.id === row.envelopeId) ? row.envelopeId : null;
      if (keepId !== null) kept.add(keepId);
      layout.push({ name: row.name, nameKey: null, keepId });
    }
  }
  return { layout, removed: candidates.filter((e) => !kept.has(e.id)) };
}
