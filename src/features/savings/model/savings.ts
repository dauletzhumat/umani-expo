import { z } from 'zod';

import { autoAllocateIncome } from '@/domain/allocation/income';
import type { EnvelopeKind } from '@/domain/allocation/envelope';
import type { CurrencyCode } from '@/domain/money/currency';
import { subtract, sum, zero, type Money } from '@/domain/money/money';
import { fromWire } from '@/domain/money/wire';

// ---------- rows ----------

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

export const PlanEnvelopeRowSchema = z.object({
  envelope_id: z.uuid(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  kind: z.enum(ENVELOPE_KINDS),
  allocation_bps: z.number().int(),
  sort_order: z.number().int(),
  balance_minor: z.string().nullable(),
});

export type PlanEnvelope = Readonly<{
  id: string;
  name: string | null;
  nameKey: string | null;
  kind: EnvelopeKind;
  allocationBps: number;
  sortOrder: number;
  balance: Money;
}>;

export function toPlanEnvelope(row: z.infer<typeof PlanEnvelopeRowSchema>, base: CurrencyCode): PlanEnvelope | null {
  const balance = fromWire(row.balance_minor ?? '0', base);
  if (!balance.ok) return null;
  return {
    id: row.envelope_id,
    name: row.name,
    nameKey: row.name_key,
    kind: row.kind,
    allocationBps: row.allocation_bps,
    sortOrder: row.sort_order,
    balance: balance.value,
  };
}

export const GoalRowSchema = z.object({
  id: z.uuid(),
  envelope_id: z.uuid(),
  target: z.string(),
  target_date: z.string().nullable(),
});

export type Goal = Readonly<{ id: string; envelopeId: string; target: Money; targetDate: string | null }>;

export function toGoal(row: z.infer<typeof GoalRowSchema>, base: CurrencyCode): Goal | null {
  const target = fromWire(row.target, base);
  if (!target.ok) return null;
  return { id: row.id, envelopeId: row.envelope_id, target: target.value, targetDate: row.target_date };
}

export const MonthRowSchema = z.object({ month: z.string(), income_minor: z.string() });

/** An account as the planner needs it (passed in by routes from the accounts feature). */
export type PlanAccount = Readonly<{
  id: string;
  name: string;
  kind: string;
  linkedEnvelopeId: string | null;
  balance: Money;
}>;

// ---------- the deposit plan (DEP-1, DEP-3) ----------

export type PlanItem = Readonly<{
  envelope: PlanEnvelope;
  /** What this envelope gets from the average month (null without income history). */
  expected: Money | null;
  /** Deposit accounts the user opened for this envelope (DEP-3). */
  accounts: readonly PlanAccount[];
}>;

export type DepositPlan = Readonly<{
  savings: readonly PlanItem[];
  /** An everyday account suggestion when the user has none (DEP-1 "optional spending account"). */
  spending: Readonly<{ expected: Money | null }> | null;
}>;

const EVERYDAY_KINDS = new Set(['card', 'current']);

/**
 * One recommendation per savings envelope, with its share of the average month (the same exact
 * split as income, INC-2) and the accounts already opened for it; plus an everyday account when
 * the user has none.
 */
export function buildDepositPlan(
  envelopes: readonly PlanEnvelope[],
  accounts: readonly PlanAccount[],
  averageIncome: Money | null,
): DepositPlan {
  const split = averageIncome === null ? null : autoAllocateIncome(averageIncome, envelopes);
  const share = (id: string): Money | null => {
    if (averageIncome === null || split === null || !split.ok) return null;
    // a 0% envelope gets no line from the split: zero
    return split.value.find((l) => l.envelopeId === id)?.amount ?? zero(averageIncome.currency);
  };
  const savings = envelopes
    .filter((e) => e.kind === 'savings')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((envelope) => ({
      envelope,
      expected: share(envelope.id),
      accounts: accounts.filter((a) => a.linkedEnvelopeId === envelope.id),
    }));

  let spending: DepositPlan['spending'] = null;
  if (!accounts.some((a) => EVERYDAY_KINDS.has(a.kind))) {
    const parts = savings.map((s) => s.expected).filter((m): m is Money => m !== null);
    spending = {
      expected:
        averageIncome === null || parts.length !== savings.length
          ? null
          : subtract(averageIncome, sum(parts, averageIncome.currency)),
    };
  }
  return { savings, spending };
}

// ---------- goal dates ----------

export const GOAL_HORIZONS = ['none', '6', '12', '24', '36'] as const;
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];

/** Today + n months, clamped to the month's last day ("2026-08-31" + 6 → "2027-02-28"). */
export function addMonths(isoDate: string, months: number): string {
  const year = Number(isoDate.slice(0, 4));
  const monthZero = Number(isoDate.slice(5, 7)) - 1 + months;
  const day = Number(isoDate.slice(8, 10));
  const targetYear = year + Math.floor(monthZero / 12);
  const targetMonth = ((monthZero % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function horizonDate(today: string, horizon: GoalHorizon): string | null {
  return horizon === 'none' ? null : addMonths(today, Number(horizon));
}

// ---------- errors and dates ----------

export const SAVINGS_ERRORS = [
  'non_positive_amount',
  'invalid_date',
  'unknown_envelope',
  'unknown_goal',
  'out_of_range',
  'invalid_amount',
] as const;
export type SavingsError = (typeof SAVINGS_ERRORS)[number] | 'failed';

export function toSavingsError(message: string | undefined): SavingsError {
  return (SAVINGS_ERRORS as readonly string[]).includes(message ?? '') ? (message as SavingsError) : 'failed';
}

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "2026-11-19" → "19.11.2026". */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year === undefined || month === undefined || day === undefined ? isoDate : `${day}.${month}.${year}`;
}
