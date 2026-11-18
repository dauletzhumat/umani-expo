import { describe, expect, it } from '@jest/globals';

import { LOCK_TIMEOUT_MS, shouldLockOnResume } from './lock-policy';

describe('shouldLockOnResume (PRD AUTH-6: re-lock after a background timeout)', () => {
  const t0 = 1_000_000;

  it('locks after the timeout when enabled', () => {
    expect(shouldLockOnResume(true, t0, t0 + LOCK_TIMEOUT_MS)).toBe(true);
    expect(shouldLockOnResume(true, t0, t0 + LOCK_TIMEOUT_MS + 1)).toBe(true);
  });

  it('does not lock for short trips to another app', () => {
    expect(shouldLockOnResume(true, t0, t0 + LOCK_TIMEOUT_MS - 1)).toBe(false);
  });

  it('never locks when disabled or when the app was never backgrounded', () => {
    expect(shouldLockOnResume(false, t0, t0 + 10 * LOCK_TIMEOUT_MS)).toBe(false);
    expect(shouldLockOnResume(true, null, t0)).toBe(false);
  });

  it('treats a clock that moved backwards as a reason to lock', () => {
    expect(shouldLockOnResume(true, t0, t0 - 1)).toBe(true);
  });
});
