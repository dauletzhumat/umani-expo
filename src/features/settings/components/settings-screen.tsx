import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { isLanguage, LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { ListRow } from '@/ui/list-row';
import { SegmentedControl } from '@/ui/segmented-control';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme, type ThemePreference } from '@/ui/theme/theme-provider';
import { SCREEN_PADDING, spacing } from '@/ui/tokens';

import { deleteAccount, savePreferences } from '../api/account';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'settings.themeSystem', light: 'settings.themeLight', dark: 'settings.themeDark' } as const;

export type SettingsScreenProps = Readonly<{
  userId: string | null;
  appLockEnabled: boolean;
  onToggleAppLock: (enabled: boolean) => Promise<boolean>;
  onSignOut: () => Promise<void>;
  /** Face ID / passcode check before deleting the account (false = cancelled or failed). */
  confirmOwner: (prompt: string) => Promise<boolean>;
}>;

/** Language, appearance (saved to the profile), app lock and account actions. */
export function SettingsScreen({ userId, appLockEnabled, onToggleAppLock, onSignOut, confirmOwner }: SettingsScreenProps) {
  const { t, i18n } = useTranslation();
  const { colors, preference, setPreference } = useTheme();
  const current: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  function changeLanguage(language: Language) {
    void setLanguage(language);
    if (userId !== null) void savePreferences(userId, { locale: language });
  }

  function changeTheme(theme: ThemePreference) {
    setPreference(theme);
    if (userId !== null) void savePreferences(userId, { theme });
  }

  async function removeAccount() {
    if (!(await confirmOwner(t('lock.confirmDelete')))) return;
    const result = await deleteAccount();
    if (!result.ok) Alert.alert(t('settings.deleteFailed'));
  }

  function confirmDelete() {
    Alert.alert(t('settings.deleteTitle'), t('settings.deleteMessage'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConfirm'),
        style: 'destructive',
        onPress: () => void removeAccount(),
      },
    ]);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bgGrouped }}
      contentContainerStyle={styles.content}>
      <Section title={t('settings.language')}>
        <SegmentedControl
          accessibilityLabel={t('settings.language')}
          value={current}
          onChange={changeLanguage}
          options={LANGUAGES.map((language) => ({ value: language, label: t(`language.${language}`) }))}
        />
      </Section>

      <Section title={t('settings.appearance')}>
        <SegmentedControl
          accessibilityLabel={t('settings.appearance')}
          value={preference}
          onChange={changeTheme}
          options={THEMES.map((theme) => ({ value: theme, label: t(THEME_LABEL[theme]) }))}
        />
      </Section>

      <Section title={t('settings.security')}>
        <Text variant="body">{t('settings.appLock')}</Text>
        <SegmentedControl
          accessibilityLabel={t('settings.appLock')}
          value={appLockEnabled ? 'on' : 'off'}
          onChange={(value) => void onToggleAppLock(value === 'on')}
          options={[
            { value: 'off', label: t('settings.off') },
            { value: 'on', label: t('settings.on') },
          ]}
        />
      </Section>

      <Section title={t('settings.account')}>
        <Surface padded={false}>
          <ListRow title={t('settings.signOut')} onPress={() => void onSignOut()} />
          <ListRow title={t('settings.deleteAccount')} onPress={confirmDelete} />
        </Surface>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <View style={styles.section}>
      <Text variant="footnote" color="textSecondary" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: SCREEN_PADDING, gap: spacing.xxl },
  section: { gap: spacing.sm },
});
