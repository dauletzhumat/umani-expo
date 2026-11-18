// i18n must initialise first (installs the Intl.PluralRules polyfill Hermes lacks).
import { i18n } from '@/lib/i18n';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { ThemeProvider, useTheme } from '@/ui/theme/theme-provider';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { t } = useTranslation();
  const { scheme, colors } = useTheme();
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

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <Stack>
        {/* title is what the back button shows on pushed screens */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('tabs.home') }} />
        <Stack.Screen
          name="settings"
          // headerBackTitle here (not only the tabs title) so a live language switch updates it
          options={{ title: t('settings.title'), headerLargeTitle: true, headerBackTitle: t('tabs.home') }}
        />
        {/* Sign-in is wired up with auth gating in M2. */}
        <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
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
          <RootNavigator />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
