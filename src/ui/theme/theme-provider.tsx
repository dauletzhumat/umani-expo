import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { colors, type ColorScheme, type ColorTokens } from '../tokens';

/** System by default; a manual light/dark override is available in Settings (PRD UX-2). */
export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeValue = Readonly<{
  scheme: ColorScheme;
  colors: ColorTokens;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}>;

const ThemeContext = createContext<ThemeValue | null>(null);

type ThemeProviderProps = Readonly<{ children: ReactNode; initialPreference?: ThemePreference }>;

export function ThemeProvider({ children, initialPreference = 'system' }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      colors: colors[scheme],
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        // Native UI (tab bar, status bar, alerts) follows the override too.
        Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
      },
    }),
    [scheme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
