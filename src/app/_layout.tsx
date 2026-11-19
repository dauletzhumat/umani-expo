// i18n must initialise first (installs the Intl.PluralRules polyfill Hermes lacks).
import { i18n, isLanguage, setLanguage } from '@/lib/i18n';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { signOut } from '@/features/auth/api/sign-in';
import { RecoveryScreen } from '@/features/auth/components/recovery-screen';
import { gateFor, type BudgetState } from '@/features/auth/model/gate';
import { SessionProvider, useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { AppLockProvider } from '@/features/security/app-lock-provider';
import { loadPreferences } from '@/features/settings/api/account';
import { ThemeProvider, useTheme } from '@/ui/theme/theme-provider';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { t } = useTranslation();
  const { scheme, colors, setPreference } = useTheme();
  const { status, userId, revalidate } = useSession();
  const queryClient = useQueryClient();
  const budget = useActiveBudget(userId);

  const budgetState: BudgetState =
    budget.data !== undefined ? (budget.data === null ? 'none' : 'exists') : budget.isError ? 'failed' : 'loading';
  const gate = gateFor(status, budgetState);

  // Signed out: drop every cached query so nothing of the previous user stays in memory.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status, queryClient]);

  // Apply the language and appearance saved on the profile, once per signed-in user. A failed
  // load (offline) is retried the next time the app becomes reachable (e.g. after recovery).
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (userId === null || gate !== 'app' || appliedFor.current === userId) return;
    appliedFor.current = userId;
    void loadPreferences(userId).then((preferences) => {
      if (preferences === null) {
        appliedFor.current = null;
        return;
      }
      if (isLanguage(preferences.locale)) void setLanguage(preferences.locale);
      setPreference(preferences.theme);
    });
  }, [userId, gate, setPreference]);

  useEffect(() => {
    if (gate !== 'splash') void SplashScreen.hideAsync();
  }, [gate]);

  if (gate === 'splash') return null;
  if (gate === 'recovery') {
    return (
      <RecoveryScreen
        onRetry={async () => {
          await revalidate(); // a dead session signs out instead of retrying forever
          await budget.refetch();
        }}
        onSignOut={signOut}
      />
    );
  }

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.bgGrouped,
      card: colors.bgSurface,
      text: colors.textPrimary,
      border: colors.borderSubtle,
    },
  };

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <Stack>
        <Stack.Protected guard={gate === 'signIn'}>
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'onboarding'}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'app'}>
          {/* title is what the back button shows on pushed screens */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('tabs.home') }} />
          <Stack.Screen
            name="settings"
            // headerBackTitle here (not only the tabs title) so a live language switch updates it
            options={{ title: t('settings.title'), headerLargeTitle: true, headerBackTitle: t('tabs.home') }}
          />
          <Stack.Screen
            name="accounts/new"
            options={{ title: t('accounts.newTitle'), presentation: 'modal', headerBackTitle: t('accounts.cancel') }}
          />
          <Stack.Screen name="accounts/[id]" options={{ title: '', headerBackTitle: t('tabs.home') }} />
          <Stack.Screen
            name="transfer"
            options={{ title: t('accounts.transferTitle'), presentation: 'modal', headerBackTitle: t('accounts.cancel') }}
          />
        </Stack.Protected>
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SessionProvider>
            <AppLockProvider>
              <RootNavigator />
            </AppLockProvider>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
