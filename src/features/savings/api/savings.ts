import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import type { CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { fromWire, toWire } from '@/domain/money/wire';
import type { MonthIncome } from '@/domain/savings/savings';
import { err, ok, type Result } from '@/domain/shared/result';
import { api, supabase } from '@/lib/supabase/client';

import {
  GoalRowSchema,
  MonthRowSchema,
  PlanEnvelopeRowSchema,
  toGoal,
  toPlanEnvelope,
  toSavingsError,
  type Goal,
  type PlanEnvelope,
  type SavingsError,
} from '../model/savings';

// ---------- reads ----------

/** Active envelopes with weights and balances (the planner needs the whole split). */
export function usePlanEnvelopes(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['envelopes', userId, 'plan', base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<PlanEnvelope[]> => {
      const { data, error } = await supabase
        .from('envelope_balances')
        .select('envelope_id, name, name_key, kind, allocation_bps, sort_order, balance_minor')
        .is('archived_at', null)
        .order('sort_order');
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(PlanEnvelopeRowSchema)
        .parse(data)
        .map((row) => {
          const envelope = toPlanEnvelope(row, base);
          if (envelope === null) throw new Error('invalid envelope row');
          return envelope;
        });
    },
  });
}

/** Active savings goals (BUD-7); target as text (CLAUDE.md rule 1). */
export function useGoals(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['savings', userId, 'goals', base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from('savings_goals')
        .select('id, envelope_id, target:target_minor::text, target_date')
        .is('archived_at', null);
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(GoalRowSchema)
        .parse(data)
        .map((row) => {
          const goal = toGoal(row, base);
          if (goal === null) throw new Error('invalid goal row');
          return goal;
        });
    },
  });
}

/** Monthly income totals in base currency (monthly_summary), for the planner's average. */
export function useMonthlyIncome(userId: string | null, base: CurrencyCode | undefined) {
  return useQuery({
    queryKey: ['savings', userId, 'income', base],
    enabled: userId !== null && base !== undefined,
    queryFn: async (): Promise<MonthIncome[]> => {
      const { data, error } = await supabase
        .from('monthly_summary')
        .select('month, income_minor')
        .order('month', { ascending: false })
        .limit(24);
      if (error !== null) throw error;
      if (base === undefined) return [];
      return z
        .array(MonthRowSchema)
        .parse(data)
        .map((row) => {
          const income = fromWire(row.income_minor, base);
          if (!income.ok) throw new Error('invalid income row');
          return { month: row.month, income: income.value };
        });
    },
  });
}

// ---------- writes (api.* RPCs only, CLAUDE.md rule 3) ----------

export function useRefreshAfterGoalWrite() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['savings'] });
  }, [queryClient]);
}

type WriteResult<T = void> = Promise<Result<T, SavingsError>>;

/** An upsert per envelope, so a retry is harmless; targetDate null clears the date. */
export async function setSavingsGoal(envelopeId: string, target: Money, targetDate: string | null): WriteResult<string> {
  const { data, error } = await api().rpc('set_savings_goal', {
    p_envelope_id: envelopeId,
    p_target: toWire(target),
    p_target_date: targetDate ?? undefined,
  });
  return error === null ? ok(String(data)) : err(toSavingsError(error.message));
}

/** Archiving twice is a no-op on the server, so a retry is harmless too. */
export async function archiveSavingsGoal(goalId: string): WriteResult {
  const { error } = await api().rpc('archive_savings_goal', { p_goal_id: goalId });
  return error === null ? ok(undefined) : err(toSavingsError(error.message));
}
