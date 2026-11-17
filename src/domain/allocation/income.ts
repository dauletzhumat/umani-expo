import { allocate } from '../money/allocate';
import { money, type Money } from '../money/money';
import { err, ok, type Result } from '../shared/result';
import type { EnvelopeKind } from './envelope';

/** An active envelope of the user's budget, as the allocation logic needs it. */
export type BudgetEnvelope<Id extends string> = Readonly<{
  id: Id;
  kind: EnvelopeKind;
  allocationBps: number;
  sortOrder: number;
}>;

/** One envelope line of an income entry (always > 0, in the budget base currency). */
export type AllocationLine<Id extends string> = Readonly<{ envelopeId: Id; amount: Money }>;

export type AutoAllocationError = 'non_positive_amount' | 'invalid_budget';

/**
 * Splits income (already in the budget base currency) across the budget's envelopes
 * by their method weights (PRD INC-2). The system Unallocated envelope gets nothing.
 * Zero parts are dropped because envelope lines must be non-zero.
 */
export function autoAllocateIncome<Id extends string>(
  income: Money,
  envelopes: readonly BudgetEnvelope<Id>[],
): Result<AllocationLine<Id>[], AutoAllocationError> {
  if (income.amountMinor <= 0n) return err('non_positive_amount');

  const targets = envelopes
    .map((envelope, index) => ({ envelope, index }))
    .filter(({ envelope }) => envelope.kind !== 'unallocated')
    .sort((a, b) => a.envelope.sortOrder - b.envelope.sortOrder || a.index - b.index)
    .map(({ envelope }) => envelope);

  const parts = allocate(
    income,
    targets.map((t) => t.allocationBps),
  );
  if (!parts.ok) return err('invalid_budget');

  const lines = targets.map((target, i) => ({ envelopeId: target.id, amount: parts.value[i] as Money }));
  return ok(lines.filter((line) => line.amount.amountMinor > 0n));
}

export type ManualPart<Id extends string> = Readonly<{ envelopeId: Id; amount: Money }>;

export type ManualAllocationError =
  | 'non_positive_amount'
  | 'currency_mismatch'
  | 'unknown_envelope'
  | 'duplicate_envelope'
  | 'negative_part'
  | 'exceeds_total'
  | 'missing_unallocated';

/**
 * Applies a user-defined split (PRD INC-3, DATABASE R6). Parts are ≥ 0 and may total
 * less than the income; the remainder goes to the Unallocated envelope. The result
 * always sums exactly to the income.
 */
export function manualAllocateIncome<Id extends string>(
  income: Money,
  envelopes: readonly BudgetEnvelope<Id>[],
  parts: readonly ManualPart<Id>[],
): Result<AllocationLine<Id>[], ManualAllocationError> {
  if (income.amountMinor <= 0n) return err('non_positive_amount');

  const assignable = new Set(envelopes.filter((e) => e.kind !== 'unallocated').map((e) => e.id));
  const seen = new Set<Id>();
  let assigned = 0n;

  for (const part of parts) {
    if (part.amount.currency !== income.currency) return err('currency_mismatch');
    if (!assignable.has(part.envelopeId)) return err('unknown_envelope');
    if (seen.has(part.envelopeId)) return err('duplicate_envelope');
    if (part.amount.amountMinor < 0n) return err('negative_part');
    seen.add(part.envelopeId);
    assigned += part.amount.amountMinor;
  }
  if (assigned > income.amountMinor) return err('exceeds_total');

  const lines: AllocationLine<Id>[] = parts
    .filter((part) => part.amount.amountMinor > 0n)
    .map((part) => ({ envelopeId: part.envelopeId, amount: part.amount }));

  const remainder = income.amountMinor - assigned;
  if (remainder > 0n) {
    const unallocated = envelopes.find((e) => e.kind === 'unallocated');
    if (unallocated === undefined) return err('missing_unallocated');
    lines.push({ envelopeId: unallocated.id, amount: money(remainder, income.currency) });
  }
  return ok(lines);
}
