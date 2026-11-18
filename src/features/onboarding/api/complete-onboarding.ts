import type { PresetMethod } from '@/domain/allocation/envelope';
import type { Money } from '@/domain/money/money';
import { toWire } from '@/domain/money/wire';
import { err, ok, type Result } from '@/domain/shared/result';
import { api } from '@/lib/supabase/client';

export type OnboardingInput = Readonly<{
  method: PresetMethod;
  firstAccount: Readonly<{ name: string; kind: 'cash' | 'card'; opening: Money }>;
  /** One key per onboarding attempt, so retries never create a second account. */
  idempotencyKey: string;
}>;

/**
 * Creates the budget (envelopes + default categories) and the first account with its opening
 * balance (PRD AUTH-5). The account is in the budget base currency, so no FX rate is needed.
 */
export async function completeOnboarding(input: OnboardingInput): Promise<Result<void, 'failed'>> {
  const budget = await api().rpc('setup_budget', {
    p_method: input.method,
    p_base_currency: input.firstAccount.opening.currency,
  });
  // A retry after a partial success finds the budget already there; that is fine.
  if (budget.error !== null && budget.error.message !== 'budget_exists') return err('failed');

  const opening = input.firstAccount.opening;
  const account = await api().rpc('create_account', {
    p_name: input.firstAccount.name,
    p_kind: input.firstAccount.kind,
    p_currency: opening.currency,
    p_idempotency_key: input.idempotencyKey,
    p_opening_balance: opening.amountMinor === 0n ? undefined : toWire(opening),
  });
  return account.error === null ? ok(undefined) : err('failed');
}
