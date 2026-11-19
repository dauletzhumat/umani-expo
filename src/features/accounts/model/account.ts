import { z } from 'zod';

import { isCurrencyCode, type CurrencyCode } from '@/domain/money/currency';
import type { Money } from '@/domain/money/money';
import { fromWire } from '@/domain/money/wire';
import { err, ok, type Result } from '@/domain/shared/result';

/** User-facing account kinds (PRD ACC-1); `system` accounts never reach the app. */
export const ACCOUNT_KINDS = ['cash', 'card', 'current', 'savings', 'deposit'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export type Account = Readonly<{
  id: string;
  name: string;
  kind: AccountKind;
  currency: CurrencyCode;
  includeInBudget: boolean;
  linkedEnvelopeId: string | null;
  archived: boolean;
  /** Balance in the account currency. */
  balance: Money;
  /** What the balance is worth to the budget, in the base currency (DATABASE §5a R2). */
  bookValue: Money;
}>;

/** A row of public.account_balances. Amounts arrive as text (CLAUDE.md rule 1). */
export const AccountRowSchema = z.object({
  account_id: z.uuid(),
  name: z.string(),
  kind: z.enum(ACCOUNT_KINDS),
  currency: z.string(),
  include_in_budget: z.boolean(),
  linked_envelope_id: z.uuid().nullable(),
  archived_at: z.string().nullable(),
  balance_minor: z.string().nullable(),
  book_value_minor: z.string().nullable(),
});
export type AccountRow = z.infer<typeof AccountRowSchema>;

export function toAccount(row: AccountRow, base: CurrencyCode): Result<Account, 'invalid_row'> {
  if (!isCurrencyCode(row.currency)) return err('invalid_row');
  const balance = fromWire(row.balance_minor ?? '0', row.currency);
  const bookValue = fromWire(row.book_value_minor ?? '0', base);
  if (!balance.ok || !bookValue.ok) return err('invalid_row');
  return ok(
    Object.freeze({
      id: row.account_id,
      name: row.name,
      kind: row.kind,
      currency: row.currency,
      includeInBudget: row.include_in_budget,
      linkedEnvelopeId: row.linked_envelope_id,
      archived: row.archived_at !== null,
      balance: balance.value,
      bookValue: bookValue.value,
    }),
  );
}

/** Today's calendar date on the device, as the RPCs expect (YYYY-MM-DD). */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** RPC error codes the account screens explain; anything else is a generic failure. */
export const ACCOUNT_ERRORS = [
  'rate_required',
  'invalid_rate',
  'same_account',
  'amount_mismatch',
  'account_archived',
  'account_limit',
  'no_change',
  'not_foreign_currency',
  'non_positive_amount',
  'invalid_name',
  'out_of_range',
  'idempotency_conflict',
] as const;
export type AccountError = (typeof ACCOUNT_ERRORS)[number] | 'failed';

export function toAccountError(message: string | undefined): AccountError {
  return (ACCOUNT_ERRORS as readonly string[]).includes(message ?? '') ? (message as AccountError) : 'failed';
}

/** A rate typed by the user ("475,5", " 475.50 ") as the strict decimal string the RPCs take. */
export function rateFromInput(input: string): string | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d{1,12}(\.\d{1,12})?$/.test(normalized) && /[1-9]/.test(normalized) ? normalized : null;
}

/** "2026-11-19" → "19.11.2026" (how dates read in Kazakhstan; avoids Hermes Intl gaps for kk). */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year === undefined || month === undefined || day === undefined ? isoDate : `${day}.${month}.${year}`;
}

/** A decimal rate for display: comma as the decimal separator in ru/kk. */
export function formatRate(rate: string, locale: 'ru' | 'kk' | 'en'): string {
  return locale === 'en' ? rate : rate.replace('.', ',');
}
