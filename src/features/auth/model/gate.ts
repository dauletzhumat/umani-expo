export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** What is known about the signed-in user's active budget. */
export type BudgetState = 'loading' | 'failed' | 'none' | 'exists';

/**
 * splash: nothing decided yet; signIn: no session; recovery: the budget could not be loaded
 * (retry or sign out); onboarding: no budget yet; app: everything.
 */
export type AppGate = 'splash' | 'signIn' | 'recovery' | 'onboarding' | 'app';

/**
 * Onboarding is "done" when the user has an active budget (DATABASE.md: one active budget per
 * user), so no separate flag can drift from reality. A failed load never falls through to
 * onboarding (that would offer to create a second budget) or to an endless splash.
 */
export function gateFor(status: AuthStatus, budget: BudgetState): AppGate {
  if (status === 'loading') return 'splash';
  if (status === 'signedOut') return 'signIn';
  switch (budget) {
    case 'loading':
      return 'splash';
    case 'failed':
      return 'recovery';
    case 'none':
      return 'onboarding';
    case 'exists':
      return 'app';
  }
}
