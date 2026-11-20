import * as Crypto from 'expo-crypto';
import { useCallback, useRef } from 'react';

/**
 * Idempotency keys per user intent (CLAUDE.md): an identical retry reuses the key, so a lost
 * response never double-posts; any change to what is being submitted makes a new key, so an
 * edited retry never collides with an earlier commit (idempotency_conflict).
 */
export function useIntentKey() {
  const last = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = useCallback((signature: string) => {
    if (last.current?.signature !== signature) last.current = { signature, key: Crypto.randomUUID() };
    return last.current.key;
  }, []);
  /** After a success: the same inputs again are a new intent (e.g. two equal transfers). */
  const reset = useCallback(() => {
    last.current = null;
  }, []);
  return { keyFor, reset };
}
