import { describe, expect, it } from '@jest/globals';

import { gateFor } from './gate';

describe('gateFor (which part of the app is reachable)', () => {
  it.each([
    ['loading', 'loading', 'splash'],
    ['loading', 'exists', 'splash'],
    ['signedOut', 'loading', 'signIn'],
    ['signedOut', 'failed', 'signIn'],
    ['signedOut', 'exists', 'signIn'],
    ['signedIn', 'loading', 'splash'], // budget still loading: keep the splash, no flash of onboarding
    ['signedIn', 'failed', 'recovery'], // never onboarding (a second budget) or an endless splash
    ['signedIn', 'none', 'onboarding'],
    ['signedIn', 'exists', 'app'],
  ] as const)('%s + budget=%s → %s', (status, budget, expected) => {
    expect(gateFor(status, budget)).toBe(expected);
  });
});
