import { err, ok, type Result } from '../shared/result';
import { money, type Money } from './money';

/** 100% in basis points. */
export const BPS_TOTAL = 10_000;

export type AllocationError = 'negative_total' | 'no_weights' | 'invalid_weight' | 'weights_not_100_percent';

/**
 * Splits a non-negative total by basis-point weights using the largest-remainder
 * (Hamilton) method on integer minor units. The parts always sum exactly to the
 * total. Leftover units go to the largest remainders; ties go to the lower index
 * (envelope sort order). Authoritative copy lives in SQL (DATABASE.md §5); both
 * are checked against supabase/fixtures/allocation.json.
 */
export function allocate(total: Money, weightsBps: readonly number[]): Result<Money[], AllocationError> {
  if (total.amountMinor < 0n) return err('negative_total');
  if (weightsBps.length === 0) return err('no_weights');
  if (!weightsBps.every((w) => Number.isInteger(w) && w >= 0 && w <= BPS_TOTAL)) return err('invalid_weight');
  if (weightsBps.reduce((a, b) => a + b, 0) !== BPS_TOTAL) return err('weights_not_100_percent');

  const denominator = BigInt(BPS_TOTAL);
  const shares = weightsBps.map((w, index) => {
    const exact = total.amountMinor * BigInt(w);
    return { index, base: exact / denominator, remainder: exact % denominator };
  });

  const allocated = shares.reduce((acc, s) => acc + s.base, 0n);
  let leftover = Number(total.amountMinor - allocated); // < weightsBps.length, safe as number

  const parts = shares.map((s) => s.base);
  const order = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of order) {
    if (leftover === 0) break;
    parts[share.index] = (parts[share.index] as bigint) + 1n;
    leftover -= 1;
  }

  return ok(parts.map((p) => money(p, total.currency)));
}
