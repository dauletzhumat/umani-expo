import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import type { CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { toWire } from '@/domain/money/wire';
import { err, ok, type Result } from '@/domain/shared/result';
import { api, supabase } from '@/lib/supabase/client';

import {
  AccountRowSchema,
  toAccount,
  toAccountError,
  todayIso,
  type Account,
  type AccountError,
  type AccountKind,
} from '../model/account';

// ---------- reads ----------

export const accountsKey = (userId: string | null) => ['accounts', userId] as const;

/** The user's accounts with balances from public.account_balances (archived ones included). */
export function useAccounts(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: [...accountsKey(userId), base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('account_balances')
        .select(
          'account_id, name, kind, currency, include_in_budget, linked_envelope_id, archived_at, balance_minor, book_value_minor',
        )
        .order('name');
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(AccountRowSchema)
        .parse(data)
        .map((row) => {
          const account = toAccount(row, base);
          if (!account.ok) throw new Error('invalid account row');
          return account.value;
        });
    },
  });
}

const FxRateSchema = z.object({ rate: z.string(), source: z.enum(['user', 'nbk', 'identity']), as_of: z.string() });
export type FxRate = Readonly<{ rate: string; source: 'user' | 'nbk' | 'identity'; asOf: string }>;

async function fetchFxRate(from: CurrencyCode, to: CurrencyCode): Promise<FxRate | null> {
  const { data, error } = await api().rpc('fx_rate', { p_from: from, p_to: to });
  if (error !== null) throw error;
  const row = z.array(FxRateSchema).parse(data)[0];
  return row === undefined ? null : { rate: row.rate, source: row.source, asOf: row.as_of };
}

export const fxKey = (from: CurrencyCode, to: CurrencyCode) => ['fx', from, to] as const;

/** Pre-fill rate for one pair (null when no rate is known yet). */
export function useFxRate(from: CurrencyCode | undefined, to: CurrencyCode | undefined) {
  return useQuery({
    queryKey: fxKey(from ?? 'KZT', to ?? 'KZT'),
    enabled: from !== undefined && to !== undefined && from !== to,
    queryFn: () => (from === undefined || to === undefined ? null : fetchFxRate(from, to)),
    staleTime: 10 * 60_000,
  });
}

/** Rates from each currency into the base, for the approximate Home total. */
export function useRatesToBase(currencies: readonly CurrencyCode[], base: CurrencyCode | undefined) {
  const foreign = base === undefined ? [] : [...new Set(currencies)].filter((c) => c !== base);
  const results = useQueries({
    queries: foreign.map((currency) => ({
      queryKey: fxKey(currency, base ?? 'KZT'),
      queryFn: () => (base === undefined ? null : fetchFxRate(currency, base)),
      staleTime: 10 * 60_000,
    })),
  });
  const rates = new Map<CurrencyCode, string>();
  results.forEach((result, index) => {
    const currency = foreign[index];
    if (currency !== undefined && result.data) rates.set(currency, result.data.rate);
  });
  return { rates, loading: results.some((r) => r.isPending) };
}

const EnvelopeRowSchema = z.object({
  envelope_id: z.uuid(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  kind: z.string(),
  sort_order: z.number(),
});
export type EnvelopeChoice = Readonly<{ id: string; name: string | null; nameKey: string | null; kind: string }>;

/** Envelopes to pick from when a transfer crosses the budget boundary (DATABASE §5a R3). */
export function useEnvelopeChoices(userId: string | null) {
  return useQuery({
    queryKey: ['envelopes', userId, 'choices'],
    enabled: userId !== null,
    queryFn: async (): Promise<EnvelopeChoice[]> => {
      const { data, error } = await supabase
        .from('envelope_balances')
        .select('envelope_id, name, name_key, kind, sort_order')
        .is('archived_at', null)
        .order('sort_order');
      if (error !== null) throw error;
      return z
        .array(EnvelopeRowSchema)
        .parse(data)
        .map((row) => ({ id: row.envelope_id, name: row.name, nameKey: row.name_key, kind: row.kind }));
    },
  });
}

// ---------- writes (all through api.* RPCs, CLAUDE.md rule 3) ----------

/** After a write, balances, envelopes, the active budget and the user's rate may all change. */
export function useRefreshAfterWrite() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      ['accounts', 'envelopes', 'budget', 'fx', 'history', 'limits', 'savings'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  }, [queryClient]);
}

type WriteResult<T = void> = Promise<Result<T, AccountError>>;

export type NewAccount = Readonly<{
  name: string;
  kind: AccountKind;
  opening: Money;
  /** Base units per one unit of the account currency; required for a foreign opening balance. */
  openingRate?: string;
  includeInBudget: boolean;
  /** A deposit opened from the planner, linked to its savings envelope (DEP-3). */
  linkedEnvelopeId?: string;
}>;

export async function createAccount(input: NewAccount, idempotencyKey: string): WriteResult<string> {
  const { data, error } = await api().rpc('create_account', {
    p_name: input.name,
    p_kind: input.kind,
    p_currency: input.opening.currency,
    p_idempotency_key: idempotencyKey,
    p_opening_balance: input.opening.amountMinor === 0n ? undefined : toWire(input.opening),
    p_opening_rate: input.openingRate,
    p_include_in_budget: input.includeInBudget,
    p_linked_envelope_id: input.linkedEnvelopeId,
  });
  return error === null ? ok(String(data)) : err(toAccountError(error.message));
}

export async function archiveAccount(accountId: string): WriteResult {
  const { error } = await api().rpc('archive_account', { p_account_id: accountId });
  return error === null ? ok(undefined) : err(toAccountError(error.message));
}

export type NewTransfer = Readonly<{
  fromId: string;
  toId: string;
  sent: Money;
  received: Money;
  /** Envelope to take from / add to when the transfer crosses the budget boundary. */
  envelopeId?: string;
  /** Only when the source is a foreign account that goes below zero (rate_required). */
  rate?: string;
}>;

export async function recordTransfer(input: NewTransfer, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('record_transfer', {
    p_from_account_id: input.fromId,
    p_to_account_id: input.toId,
    p_amount_from: toWire(input.sent),
    p_amount_to: toWire(input.received),
    p_occurred_on: todayIso(),
    p_idempotency_key: idempotencyKey,
    p_envelope_id: input.envelopeId,
    p_fx_rate: input.rate,
  });
  return error === null ? ok(undefined) : err(toAccountError(error.message));
}

/** Reconciliation (PRD ACC-7): set the real balance; the difference goes to Unallocated. */
export async function reconcileAccount(
  accountId: string,
  target: Money,
  idempotencyKey: string,
  rate?: string,
): WriteResult {
  const { error } = await api().rpc('record_adjustment', {
    p_account_id: accountId,
    p_target_balance: toWire(target),
    p_occurred_on: todayIso(),
    p_idempotency_key: idempotencyKey,
    p_fx_rate: rate,
  });
  return error === null ? ok(undefined) : err(toAccountError(error.message));
}

/** "Update to current rate" (DATABASE §5a R4): book value moves, the difference goes to Unallocated. */
export async function revalueAccount(accountId: string, rate: string, idempotencyKey: string): WriteResult {
  const { error } = await api().rpc('record_revaluation', {
    p_account_id: accountId,
    p_rate: rate,
    p_occurred_on: todayIso(),
    p_idempotency_key: idempotencyKey,
  });
  return error === null ? ok(undefined) : err(toAccountError(error.message));
}
