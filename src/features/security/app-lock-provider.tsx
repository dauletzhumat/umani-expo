import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { signOut } from '@/features/auth/api/sign-in';
import { useSession } from '@/features/auth/session-provider';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme/theme-provider';
import { SCREEN_PADDING, spacing } from '@/ui/tokens';

import { shouldLockOnResume } from './model/lock-policy';

const PREFERENCE_KEY = 'umani.app_lock';

type AppLockValue = Readonly<{
  enabled: boolean;
  /** Turning the lock on asks for Face ID / passcode first, so the user can't lock themselves out. */
  setEnabled: (enabled: boolean) => Promise<boolean>;
}>;

const AppLockContext = createContext<AppLockValue | null>(null);

async function authenticate(prompt: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt });
  return result.success;
}

/**
 * App lock (PRD AUTH-6): opt-in Face ID / passcode, re-lock after a background timeout, and a
 * privacy cover whenever the app is not active (app switcher) so balances are never visible.
 */
export function AppLockProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [enabled, setEnabledState] = useState(false);
  // Start covered until the preference is known (no unlocked frames on cold start).
  const [locked, setLocked] = useState(true);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const backgroundedAt = useRef<number | null>(null);
  const { status } = useSession();
  const signedOut = useRef(false);
  useEffect(() => {
    signedOut.current = status === 'signedOut';
  }, [status]);

  useEffect(() => {
    SecureStore.getItemAsync(PREFERENCE_KEY)
      .then((value) => {
        const on = value === 'on' && !signedOut.current; // a signed-out app has nothing to lock
        setEnabledState(on);
        setLocked(on); // lock on: stay locked until authenticated
      })
      .catch(() => {
        // Fail closed: if the preference can't be read, require authentication.
        if (signedOut.current) return;
        setEnabledState(true);
        setLocked(true);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active') {
        if (shouldLockOnResume(enabled, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [enabled]);

  // Signed out (sign-out, account deletion, lost session): the lock protected that account only.
  // Clear it so the next account starts unlocked and is offered the lock again.
  useEffect(() => {
    if (status !== 'signedOut') return;
    void SecureStore.deleteItemAsync(PREFERENCE_KEY).finally(() => {
      setEnabledState(false);
      setLocked(false);
    });
  }, [status]);

  const value = useMemo<AppLockValue>(
    () => ({
      enabled,
      setEnabled: async (next) => {
        if (next && !(await authenticate(t('lock.prompt')))) return false;
        await SecureStore.setItemAsync(PREFERENCE_KEY, next ? 'on' : 'off');
        setEnabledState(next);
        return true;
      },
    }),
    [enabled, t],
  );

  const unlock = async () => {
    if (await authenticate(t('lock.prompt'))) setLocked(false);
  };

  // Signed out there is nothing to protect, even before the preference is cleared.
  const covered = (locked && status !== 'signedOut') || !active || !ready;

  return (
    <AppLockContext.Provider value={value}>
      {/* While covered, hide the content from VoiceOver as well as from sight. */}
      <View
        style={styles.flex}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {covered && (
        <View
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.bgCanvas }]}>
          <Text variant="title1" accessibilityRole="header">
            UMANI
          </Text>
          {ready && locked && active && (
            <View style={styles.lock}>
              <Text variant="callout" color="textSecondary">
                {t('lock.title')}
              </Text>
              <Button label={t('lock.unlock')} onPress={() => void unlock()} />
              {/* Escape hatch if Face ID / passcode were removed: signing out reveals no data. */}
              <Button variant="ghost" label={t('lock.signOut')} onPress={() => void signOut()} />
            </View>
          )}
        </View>
      )}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const value = useContext(AppLockContext);
  if (value === null) throw new Error('useAppLock must be used inside AppLockProvider');
  return value;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center', padding: SCREEN_PADDING, gap: spacing.xxl },
  lock: { alignSelf: 'stretch', gap: spacing.md, alignItems: 'center' },
});
