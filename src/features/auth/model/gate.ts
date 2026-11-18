export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** splash: nothing decided yet; signIn: no session; onboarding: no budget yet; app: everything. */
export type AppGate = 'splash' | 'signIn' | 'onboarding' | 'app';

/**
 * Onboarding is "done" when the user has an active budget (DATABASE.md: one active budget per
 * user), so no separate flag can drift from reality.
 */
export function gateFor(status: AuthStatus, hasBudget: boolean | undefined): AppGate {
  if (status === 'loading') return 'splash';
  if (status === 'signedOut') return 'signIn';
  if (hasBudget === undefined) return 'splash';
  return hasBudget ? 'app' : 'onboarding';
}
