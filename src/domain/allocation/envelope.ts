/** Envelope kinds; must match the `envelope_kind` enum in DATABASE.md. */
export type EnvelopeKind =
  | 'needs'
  | 'wants'
  | 'savings'
  | 'spending'
  | 'living'
  | 'debt_giving'
  | 'custom'
  | 'unallocated';

/** Preset methods; with 'custom' they match the `budget_method` enum in DATABASE.md. */
export type PresetMethod = '50_30_20' | '80_20' | '90_10' | '70_20_10';
export type BudgetMethod = PresetMethod | 'custom';
