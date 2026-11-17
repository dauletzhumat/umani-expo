import { BPS_TOTAL } from '../money/allocate';
import { err, ok, type Result } from '../shared/result';

/** PRD BUD-2 limits. */
export const MIN_CUSTOM_ENVELOPES = 1;
export const MAX_CUSTOM_ENVELOPES = 12;
export const MAX_ENVELOPE_NAME_LENGTH = 40;

export type CustomEnvelopeKind = 'custom' | 'savings';

export type CustomEnvelopeInput = Readonly<{
  name: string;
  allocationBps: number;
  /** 'savings' marks envelopes for the deposits planner and savings goals. Defaults to 'custom'. */
  kind?: CustomEnvelopeKind;
}>;

export type CustomEnvelope = Readonly<{ kind: CustomEnvelopeKind; name: string; allocationBps: number }>;

/** Errors carry the envelope index so the editor can highlight the field. */
export type CustomBudgetError =
  | { readonly code: 'too_few_envelopes' }
  | { readonly code: 'too_many_envelopes' }
  | { readonly code: 'invalid_name'; readonly index: number }
  | { readonly code: 'duplicate_name'; readonly index: number }
  | { readonly code: 'invalid_percentage'; readonly index: number }
  | { readonly code: 'not_100_percent'; readonly totalBps: number };

/** Validates and normalises a custom budget: 1–12 envelopes, unique non-empty names, 0.01–100% each, total exactly 100%. */
export function validateCustomBudget(
  inputs: readonly CustomEnvelopeInput[],
): Result<CustomEnvelope[], CustomBudgetError> {
  if (inputs.length < MIN_CUSTOM_ENVELOPES) return err({ code: 'too_few_envelopes' });
  if (inputs.length > MAX_CUSTOM_ENVELOPES) return err({ code: 'too_many_envelopes' });

  const seenNames = new Set<string>();
  const envelopes: CustomEnvelope[] = [];
  let totalBps = 0;

  for (const [index, input] of inputs.entries()) {
    const name = input.name.trim();
    const length = Array.from(name).length;
    if (length === 0 || length > MAX_ENVELOPE_NAME_LENGTH) return err({ code: 'invalid_name', index });

    const key = name.toLocaleLowerCase();
    if (seenNames.has(key)) return err({ code: 'duplicate_name', index });
    seenNames.add(key);

    const bps = input.allocationBps;
    if (!Number.isInteger(bps) || bps < 1 || bps > BPS_TOTAL) return err({ code: 'invalid_percentage', index });

    totalBps += bps;
    envelopes.push(Object.freeze({ kind: input.kind ?? 'custom', name, allocationBps: bps }));
  }

  if (totalBps !== BPS_TOTAL) return err({ code: 'not_100_percent', totalBps });
  return ok(envelopes);
}

const PERCENT_PATTERN = /^([0-9]{1,3})(?:[.,]([0-9]{1,2}))?\s*%?$/;

/** Parses a typed percentage ("33,33", "12.5 %") into basis points. 0 < value ≤ 100, at most 2 decimals. */
export function parsePercentToBps(input: string): Result<number, 'invalid_percentage'> {
  const match = PERCENT_PATTERN.exec(input.trim());
  if (match === null) return err('invalid_percentage');
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const bps = whole * 100 + fraction;
  if (bps < 1 || bps > BPS_TOTAL) return err('invalid_percentage');
  return ok(bps);
}
