import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import type { CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { toWire } from '@/domain/money/wire';
import { err, ok, type Result } from '@/domain/shared/result';
import { api, supabase } from '@/lib/supabase/client';
import type { RateSuggestion } from '@/ui/rate-field';

import {
  CategoryRowSchema,
  EnvelopeRowSchema,
  HistoryRowSchema,
  LimitProgressRowSchema,
  sortCategories,
  toCategory,
  toExpenseError,
  toHistory,
  toLimitProgress,
  toSpendEnvelope,
  type Category,
  type CategoryKind,
  type ExpenseError,
  type HistoryItem,
  type LimitProgress,
  type SpendEnvelope,
} from '../model/expense';

// ---------- reads ----------

/**
 * Edit screens read a snapshot under their own key: a write invalidates the list keys, and the
 * screen being left must not refetch and flash "not found" while it slides away. gcTime 0 means
 * the next open loads fresh data.
 */
const SNAPSHOT = { gcTime: 0 } as const;

/** Active categories of both kinds: defaults in template order, then the user's own. */
export function useCategories(userId: string | null, snapshot = false) {
  return useQuery({
    ...(snapshot ? SNAPSHOT : {}),
    queryKey: [snapshot ? 'category-snapshot' : 'categories', userId, 'all'],
    enabled: userId !== null,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, kind, name, name_key, default_envelope_id')
        .is('archived_at', null)
        .order('created_at')
        .order('id');
      if (error !== null) throw error;
      return sortCategories(z.array(CategoryRowSchema).parse(data).map(toCategory));
    },
  });
}

/** Envelopes expenses can come out of, with balances (Unallocated excluded). */
export function useSpendEnvelopes(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['envelopes', userId, 'spend', base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<SpendEnvelope[]> => {
      const { data, error } = await supabase
        .from('envelope_balances')
        .select('envelope_id, name, name_key, kind, balance_minor')
        .is('archived_at', null)
        .neq('kind', 'unallocated')
        .order('sort_order');
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(EnvelopeRowSchema)
        .parse(data)
        .map((row) => {
          const envelope = toSpendEnvelope(row, base);
          if (envelope === null) throw new Error('invalid envelope row');
          return envelope;
        });
    },
  });
}

/** The limits that apply to the month with what was spent (EXP-4). */
export function useLimitProgress(userId: string | null, base: CurrencyCode | undefined, month: string, snapshot = false) {
  return useQuery({
    ...(snapshot ? SNAPSHOT : {}),
    queryKey: [snapshot ? 'limit-snapshot' : 'limits', userId, base, month],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<LimitProgress[]> => {
      const { data, error } = await api().rpc('limit_progress', { p_month: month });
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(LimitProgressRowSchema)
        .parse(data)
        .map((row) => {
          const progress = toLimitProgress(row, base);
          if (progress === null) throw new Error('invalid limit row');
          return progress;
        });
    },
  });
}

const FxRateSchema = z.object({ rate: z.string(), source: z.enum(['user', 'nbk', 'identity']), as_of: z.string() });

/** Pre-fill rate for a foreign overdraft (same cache entry as the other features' rate lookups). */
export function useExpenseRate(from: CurrencyCode | undefined, to: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['fx', from ?? 'KZT', to ?? 'KZT'],
    enabled: from !== undefined && to !== undefined && from !== to,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RateSuggestion | null> => {
      if (from === undefined || to === undefined) return null;
      const { data, error } = await api().rpc('fx_rate', { p_from: from, p_to: to });
      if (error !== null) throw error;
      const row = z.array(FxRateSchema).parse(data)[0];
      return row === undefined ? null : { rate: row.rate, source: row.source, asOf: row.as_of };
    },
  });
}

const HISTORY_COLUMNS = 'entry_id, kind, occurred_on, category_id, note, account_id, currency, amount_minor, envelope_id';

/**
 * Transaction history, newest first (EXP-5). Reversed entries and their reversals are hidden
 * (the audit trail stays in the ledger). accountId null = all accounts (ACC-5).
 */
export function useHistory(userId: string | null, accountId: string | null, limit: number) {
  return useQuery({
    queryKey: ['history', userId, accountId ?? 'all', limit],
    enabled: userId !== null,
    // "Show more" and the account switch keep the current rows until the new page arrives
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<HistoryItem[]> => {
      let query = supabase
        .from('entry_history')
        .select(HISTORY_COLUMNS)
        .eq('is_reversed', false)
        .is('reverses_entry_id', null)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .order('entry_id')
        .limit(limit);
      if (accountId !== null) query = query.eq('account_id', accountId);
      const { data, error } = await query;
      if (error !== null) throw error;
      return toHistory(z.array(HistoryRowSchema).parse(data));
    },
  });
}

/** One live expense for editing; null when it was undone or is not an expense. */
export function useExpenseEntry(userId: string | null, entryId: string | undefined) {
  return useQuery({
    ...SNAPSHOT,
    queryKey: ['expense-snapshot', userId, entryId],
    enabled: userId !== null && entryId !== undefined,
    queryFn: async (): Promise<HistoryItem | null> => {
      if (entryId === undefined) return null;
      const { data, error } = await supabase
        .from('entry_history')
        .select(HISTORY_COLUMNS)
        .eq('entry_id', entryId)
        .eq('kind', 'expense')
        .eq('is_reversed', false);
      if (error !== null) throw error;
      return toHistory(z.array(HistoryRowSchema).parse(data))[0] ?? null;
    },
  });
}

// ---------- writes (api.* RPCs only, CLAUDE.md rule 3) ----------

function useInvalidate(keys: readonly string[]) {
  const queryClient = useQueryClient();
  const joined = keys.join(',');
  return useCallback(async () => {
    await Promise.all(joined.split(',').map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  }, [queryClient, joined]);
}

/** Expenses move balances, envelopes, limits and the history (fx: a foreign overdraft records a rate). */
export function useRefreshAfterExpenseWrite() {
  return useInvalidate(['accounts', 'envelopes', 'budget', 'fx', 'income', 'history', 'limits']);
}

/** Category and limit edits change pickers, limit progress and history labels. */
export function useRefreshAfterSetupWrite() {
  return useInvalidate(['categories', 'limits', 'history']);
}

type WriteResult<T = void> = Promise<Result<T, ExpenseError>>;

export type ExpenseInput = Readonly<{
  accountId: string;
  /** In the account currency. */
  amount: Money;
  occurredOn: string;
  /** Required for budgeted accounts; null for accounts outside the budget. */
  envelopeId: string | null;
  categoryId: string | null;
  note: string;
  /** Base units per one unit of the account currency; only for a foreign overdraft. */
  rate?: string;
}>;

const trimmedNote = (note: string) => (note.trim() === '' ? null : note.trim());

export async function recordExpense(input: ExpenseInput, idempotencyKey: string): WriteResult<string> {
  const { data, error } = await api().rpc('record_expense', {
    p_account_id: input.accountId,
    p_amount: toWire(input.amount),
    p_occurred_on: input.occurredOn,
    p_idempotency_key: idempotencyKey,
    p_envelope_id: input.envelopeId ?? undefined,
    p_category_id: input.categoryId ?? undefined,
    p_fx_rate: input.rate,
    p_note: trimmedNote(input.note) ?? undefined,
  });
  return error === null ? ok(String(data)) : err(toExpenseError(error.message));
}

/** Edit = reversal + new entry in one call (EXP-5); the reversal keeps the original date. */
export async function amendExpense(entryId: string, input: ExpenseInput, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('amend_entry', {
    p_entry_id: entryId,
    p_idempotency_key: idempotencyKey,
    p_new: {
      kind: 'expense',
      account_id: input.accountId,
      envelope_id: input.envelopeId,
      amount: toWire(input.amount),
      occurred_on: input.occurredOn,
      category_id: input.categoryId,
      fx_rate: input.rate ?? null,
      note: trimmedNote(input.note),
    },
  });
  return error === null ? ok(undefined) : err(toExpenseError(error.message));
}

export async function reverseEntry(entryId: string, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('reverse_entry', { p_entry_id: entryId, p_idempotency_key: idempotencyKey });
  return error === null ? ok(undefined) : err(toExpenseError(error.message));
}

export async function createCategory(
  kind: CategoryKind,
  name: string,
  defaultEnvelopeId: string | null,
  idempotencyKey: string,
): WriteResult<string> {
  const { data, error } = await api().rpc('create_category', {
    p_kind: kind,
    p_name: name.trim(),
    p_idempotency_key: idempotencyKey,
    p_default_envelope_id: defaultEnvelopeId ?? undefined,
  });
  return error === null ? ok(String(data)) : err(toExpenseError(error.message));
}

/** name undefined = keep it; defaultEnvelopeId null = clear it. The same call twice is harmless. */
export async function updateCategory(
  categoryId: string,
  change: Readonly<{ name?: string; defaultEnvelopeId: string | null }>,
): WriteResult {
  const { error } = await api().rpc('update_category', {
    p_category_id: categoryId,
    p_name: change.name?.trim(),
    p_default_envelope_id: change.defaultEnvelopeId ?? undefined,
    p_clear_default: change.defaultEnvelopeId === null,
  });
  return error === null ? ok(undefined) : err(toExpenseError(error.message));
}

export async function archiveCategory(categoryId: string): WriteResult {
  const { error } = await api().rpc('archive_category', { p_category_id: categoryId });
  return error === null ? ok(undefined) : err(toExpenseError(error.message));
}

export type LimitTarget = Readonly<{ envelopeId: string } | { categoryId: string }>;

/** A recurring monthly limit (an upsert per target, so a retry is harmless). */
export async function setLimit(target: LimitTarget, amount: Money): WriteResult<string> {
  const { data, error } = await api().rpc('set_limit', {
    p_limit: toWire(amount),
    p_envelope_id: 'envelopeId' in target ? target.envelopeId : undefined,
    p_category_id: 'categoryId' in target ? target.categoryId : undefined,
  });
  return error === null ? ok(String(data)) : err(toExpenseError(error.message));
}

export async function deleteLimit(limitId: string): WriteResult {
  const { error } = await api().rpc('delete_limit', { p_limit_id: limitId });
  return error === null ? ok(undefined) : err(toExpenseError(error.message));
}
