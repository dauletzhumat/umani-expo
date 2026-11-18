import { describe, expect, it } from '@jest/globals';

import { gateFor } from './gate';

describe('gateFor (which part of the app is reachable)', () => {
  it.each([
    ['loading', undefined, 'splash'],
    ['loading', true, 'splash'],
    ['signedOut', undefined, 'signIn'],
    ['signedOut', true, 'signIn'],
    ['signedIn', undefined, 'splash'], // budget still loading: keep the splash, no flash of onboarding
    ['signedIn', false, 'onboarding'],
    ['signedIn', true, 'app'],
  ] as const)('%s + hasBudget=%p → %s', (status, hasBudget, expected) => {
    expect(gateFor(status, hasBudget)).toBe(expected);
  });
});
