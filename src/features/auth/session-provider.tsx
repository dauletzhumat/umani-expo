import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase/client';

import type { AuthStatus } from './model/gate';

type SessionValue = Readonly<{
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  /** Re-reads the stored session; signs out in the UI if it is gone (e.g. storage was cleared). */
  revalidate: () => Promise<void>;
}>;

const SessionContext = createContext<SessionValue | null>(null);

/** Tracks the Supabase session (restored from encrypted storage on launch). */
export function SessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(data.session ? 'signedIn' : 'signedOut');
      })
      .catch(() => {
        // Fail closed: unreadable storage means "signed out", never an endless splash.
        if (active) setStatus('signedOut');
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const revalidate = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    // Only a successful read with no session signs out; a network error during refresh does not.
    if (error === null && data.session === null) {
      setSession(null);
      setStatus('signedOut');
    }
  }, []);

  // Coming back to the foreground: the stored session may have expired or been removed meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void revalidate();
    });
    return () => subscription.remove();
  }, [revalidate]);

  const value = useMemo<SessionValue>(
    () => ({ status, session, userId: session?.user.id ?? null, revalidate }),
    [status, session, revalidate],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
