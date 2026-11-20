import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import type { BudgetMethod } from '@/domain/allocation/envelope';
import type { CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { toWire } from '@/domain/money/wire';
import { err, ok, type Result } from '@/domain/shared/result';
import { api, supabase } from '@/lib/supabase/client';
import type { RateSuggestion } from '@/ui/rate-field';

import {
  CategoryRowSchema,
  EnvelopeRowSchema,
  IncomeEntryRowSchema,
  IncomeLineRowSchema,
  toBudgetError,
  toEnvelope,
  toIncomeEntries,
  todayIso,
  type BudgetError,
  type Category,
  type Envelope,
  type IncomeEntry,
} from '../model/budget';

// ---------- reads ----------

/** Active envelopes with balances (Unallocated included), in sort order. */
export function useEnvelopes(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['envelopes', userId, base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<Envelope[]> => {
      const { data, error } = await supabase
        .from('envelope_balances')
        .select('envelope_id, name, name_key, kind, allocation_bps, sort_order, balance_minor')
        .is('archived_at', null)
        .order('sort_order');
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(EnvelopeRowSchema)
        .parse(data)
        .map((row) => {
          const envelope = toEnvelope(row, base);
          if (envelope === null) throw new Error('invalid envelope row');
          return envelope;
        });
    },
  });
}

export function useIncomeCategories(userId: string | null) {
  return useQuery({
    queryKey: ['categories', userId, 'income'],
    enabled: userId !== null,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, name_key')
        .eq('kind', 'income')
        .is('archived_at', null)
        .order('created_at');
      if (error !== null) throw error;
      return z
        .array(CategoryRowSchema)
        .parse(data)
        .map((row) => ({ id: row.id, name: row.name, nameKey: row.name_key }));
    },
  });
}

/** The latest incomes that can still be edited or undone (INC-5). */
export function useRecentIncome(userId: string | null, accountIds: readonly string[], limit = 20) {
  return useQuery({
    queryKey: ['income', userId, accountIds.join(','), limit],
    enabled: userId !== null && accountIds.length > 0,
    queryFn: async (): Promise<IncomeEntry[]> => {
      const entries = await supabase
        .from('reportable_entries')
        .select('id, occurred_on, note, category_id')
        .eq('kind', 'income')
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (entries.error !== null) throw entries.error;
      const parsed = z.array(IncomeEntryRowSchema).parse(entries.data);
      if (parsed.length === 0) return [];
      // amounts as text: PostgREST would send bigint as a JSON number (CLAUDE.md rule 1)
      const lines = await supabase
        .from('ledger_lines')
        .select('entry_id, account_id, currency, amount:amount_minor::text')
        .in(
          'entry_id',
          parsed.map((e) => e.id),
        )
        .in('account_id', [...accountIds]);
      if (lines.error !== null) throw lines.error;
      return toIncomeEntries(parsed, z.array(IncomeLineRowSchema).parse(lines.data), new Set(accountIds));
    },
  });
}

const EntryAllocationRowSchema = z.object({
  envelope_id: z.uuid(),
  amount: z.string(),
  fx_rate: z.string().nullable(),
});

export type IncomeEntryDetails = Readonly<{
  entry: IncomeEntry;
  /** Envelope lines of the original entry (base currency), Unallocated included. */
  parts: readonly Readonly<{ envelopeId: string; amount: string }>[];
  /** The rate the user confirmed for a foreign-currency income, if it was recorded. */
  rate: string | null;
}>;

/** One income with its original split and rate, for editing (INC-5) — not limited to the latest. */
export function useIncomeEntry(userId: string | null, entryId: string | undefined, accountIds: readonly string[]) {
  return useQuery({
    queryKey: ['income', userId, 'entry', entryId, accountIds.join(',')],
    enabled: userId !== null && entryId !== undefined && accountIds.length > 0,
    queryFn: async (): Promise<IncomeEntryDetails | null> => {
      if (entryId === undefined) return null;
      const entries = await supabase
        .from('reportable_entries')
        .select('id, occurred_on, note, category_id')
        .eq('kind', 'income')
        .eq('id', entryId);
      if (entries.error !== null) throw entries.error;
      const parsed = z.array(IncomeEntryRowSchema).parse(entries.data);
      if (parsed.length === 0) return null;
      const lines = await supabase
        .from('ledger_lines')
        .select('entry_id, account_id, currency, amount:amount_minor::text')
        .eq('entry_id', entryId)
        .in('account_id', [...accountIds]);
      if (lines.error !== null) throw lines.error;
      const entry = toIncomeEntries(parsed, z.array(IncomeLineRowSchema).parse(lines.data), new Set(accountIds))[0];
      if (entry === undefined) return null;
      const allocation = await supabase
        .from('envelope_lines')
        .select('envelope_id, amount:amount_minor::text, fx_rate:fx_rate::text')
        .eq('entry_id', entryId);
      if (allocation.error !== null) throw allocation.error;
      const rows = z.array(EntryAllocationRowSchema).parse(allocation.data);
      return {
        entry,
        parts: rows.map((r) => ({ envelopeId: r.envelope_id, amount: r.amount })),
        rate: rows.find((r) => r.fx_rate !== null)?.fx_rate ?? null,
      };
    },
  });
}

const FxRateSchema = z.object({ rate: z.string(), source: z.enum(['user', 'nbk', 'identity']), as_of: z.string() });

/** Pre-fill rate for income in a foreign account (INC-4). */
export function useIncomeRate(from: CurrencyCode | undefined, to: CurrencyCode | undefined) {
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

// ---------- writes (api.* RPCs only, CLAUDE.md rule 3) ----------

/** Income, reallocations and method switches move balances, envelopes and the user's rate. */
export function useRefreshAfterBudgetWrite() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      ['accounts', 'envelopes', 'budget', 'fx', 'income', 'history', 'limits'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  }, [queryClient]);
}

type WriteResult<T = void> = Promise<Result<T, BudgetError>>;

export type IncomeInput = Readonly<{
  accountId: string;
  amount: Money;
  occurredOn: string;
  categoryId: string | null;
  note: string;
  /** Base units per one unit of the account currency; foreign accounts only. */
  rate?: string;
  /** Manual split in the base currency (INC-3); undefined = automatic by the method (INC-2). */
  manualParts?: readonly Readonly<{ envelopeId: string; amount: Money }>[];
}>;

function allocationJson(input: IncomeInput) {
  return input.manualParts === undefined
    ? { mode: 'auto' }
    : {
        mode: 'manual',
        parts: input.manualParts.map((p) => ({ envelope_id: p.envelopeId, amount: toWire(p.amount) })),
      };
}

export async function recordIncome(input: IncomeInput, idempotencyKey: string): WriteResult<string> {
  const { data, error } = await api().rpc('record_income', {
    p_account_id: input.accountId,
    p_amount: toWire(input.amount),
    p_occurred_on: input.occurredOn,
    p_idempotency_key: idempotencyKey,
    p_category_id: input.categoryId ?? undefined,
    p_allocation: allocationJson(input),
    p_fx_rate: input.rate,
    p_note: input.note.trim() === '' ? undefined : input.note.trim(),
  });
  return error === null ? ok(String(data)) : err(toBudgetError(error.message));
}

/** Edit = reversal + new entry in one call (INC-5); the reversal keeps the original date. */
export async function amendIncome(entryId: string, input: IncomeInput, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('amend_entry', {
    p_entry_id: entryId,
    p_idempotency_key: idempotencyKey,
    p_new: {
      kind: 'income',
      account_id: input.accountId,
      amount: toWire(input.amount),
      occurred_on: input.occurredOn,
      category_id: input.categoryId,
      allocation: allocationJson(input),
      fx_rate: input.rate ?? null,
      note: input.note.trim() === '' ? null : input.note.trim(),
    },
  });
  return error === null ? ok(undefined) : err(toBudgetError(error.message));
}

export async function reverseEntry(entryId: string, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('reverse_entry', { p_entry_id: entryId, p_idempotency_key: idempotencyKey });
  return error === null ? ok(undefined) : err(toBudgetError(error.message));
}

export async function reallocate(fromId: string, toId: string, amount: Money, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('reallocate', {
    p_from_envelope_id: fromId,
    p_to_envelope_id: toId,
    p_amount: toWire(amount),
    p_occurred_on: todayIso(),
    p_idempotency_key: idempotencyKey,
  });
  return error === null ? ok(undefined) : err(toBudgetError(error.message));
}

export type CustomLayoutItem = Readonly<{
  name: string;
  allocationBps: number;
  kind: 'custom' | 'savings';
  envelopeId?: string;
}>;

export async function changeBudgetMethod(
  method: BudgetMethod,
  idempotencyKey: string,
  custom: readonly CustomLayoutItem[] | undefined,
  reassign: Readonly<Record<string, number | 'unallocated'>>,
): WriteResult {
  const { error } = await api().rpc('change_budget_method', {
    p_method: method,
    p_idempotency_key: idempotencyKey,
    p_custom: custom?.map((item) => ({
      name: item.name,
      allocation_bps: item.allocationBps,
      kind: item.kind,
      ...(item.envelopeId === undefined ? {} : { envelope_id: item.envelopeId }),
    })),
    p_reassign: Object.keys(reassign).length === 0 ? undefined : reassign,
  });
  return error === null ? ok(undefined) : err(toBudgetError(error.message));
}
