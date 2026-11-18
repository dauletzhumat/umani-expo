/** Default re-lock timeout (PRD AUTH-6). */
export const LOCK_TIMEOUT_MS = 60_000;

/**
 * Whether returning to the foreground should show the lock screen. A clock that moved backwards
 * (manual time change) also locks, so it can't be used to skip the timeout.
 */
export function shouldLockOnResume(
  enabled: boolean,
  backgroundedAt: number | null,
  now: number,
  timeoutMs: number = LOCK_TIMEOUT_MS,
): boolean {
  if (!enabled || backgroundedAt === null) return false;
  const elapsed = now - backgroundedAt;
  return elapsed < 0 || elapsed >= timeoutMs;
}
