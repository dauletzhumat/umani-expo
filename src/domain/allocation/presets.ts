import type { BudgetMethod, EnvelopeKind, PresetMethod } from './envelope';

/** An envelope created by a preset; `nameKey` is the i18n key of its localised default name. */
export type PresetEnvelope = Readonly<{
  kind: Exclude<EnvelopeKind, 'custom' | 'unallocated'>;
  nameKey: string;
  allocationBps: number;
}>;

function envelope(kind: PresetEnvelope['kind'], nameKey: string, allocationBps: number): PresetEnvelope {
  return Object.freeze({ kind, nameKey, allocationBps });
}

/** PRD BUD-1. Order = envelope sort order (also the rounding tie-break order). */
const PRESETS: Readonly<Record<PresetMethod, readonly PresetEnvelope[]>> = Object.freeze({
  '50_30_20': Object.freeze([
    envelope('needs', 'envelope.needs', 5_000),
    envelope('wants', 'envelope.wants', 3_000),
    envelope('savings', 'envelope.savings', 2_000),
  ]),
  '80_20': Object.freeze([envelope('spending', 'envelope.spending', 8_000), envelope('savings', 'envelope.savings', 2_000)]),
  '90_10': Object.freeze([envelope('spending', 'envelope.spending', 9_000), envelope('savings', 'envelope.savings', 1_000)]),
  '70_20_10': Object.freeze([
    envelope('living', 'envelope.living', 7_000),
    envelope('savings', 'envelope.savings', 2_000),
    envelope('debt_giving', 'envelope.debtGiving', 1_000),
  ]),
});

export const PRESET_METHODS: readonly PresetMethod[] = Object.freeze(Object.keys(PRESETS) as PresetMethod[]);

const BUDGET_METHODS: ReadonlySet<string> = new Set<string>([...PRESET_METHODS, 'custom']);

export function isBudgetMethod(value: string): value is BudgetMethod {
  return BUDGET_METHODS.has(value);
}

export function presetEnvelopes(method: PresetMethod): readonly PresetEnvelope[] {
  return PRESETS[method];
}
