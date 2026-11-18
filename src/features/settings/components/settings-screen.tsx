import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isLanguage, LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { SegmentedControl } from '@/ui/segmented-control';
import { Text } from '@/ui/text';
import { useTheme, type ThemePreference } from '@/ui/theme/theme-provider';
import { SCREEN_PADDING, spacing } from '@/ui/tokens';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'settings.themeSystem', light: 'settings.themeLight', dark: 'settings.themeDark' } as const;

/**
 * Language and appearance. In-memory for now; persisted to the profile (locale, theme)
 * once sign-in exists (M2).
 */
export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, preference, setPreference } = useTheme();
  const current: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bgGrouped }}
      contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text variant="footnote" color="textSecondary" accessibilityRole="header">
          {t('settings.language')}
        </Text>
        <SegmentedControl
          accessibilityLabel={t('settings.language')}
          value={current}
          onChange={(language) => void setLanguage(language)}
          options={LANGUAGES.map((language) => ({ value: language, label: t(`language.${language}`) }))}
        />
      </View>

      <View style={styles.section}>
        <Text variant="footnote" color="textSecondary" accessibilityRole="header">
          {t('settings.appearance')}
        </Text>
        <SegmentedControl
          accessibilityLabel={t('settings.appearance')}
          value={preference}
          onChange={setPreference}
          options={THEMES.map((theme) => ({ value: theme, label: t(THEME_LABEL[theme]) }))}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: SCREEN_PADDING, gap: spacing.xxl },
  section: { gap: spacing.sm },
});
