import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme/theme-provider';
import { SCREEN_PADDING, spacing } from '@/ui/tokens';

export type RecoveryScreenProps = Readonly<{
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
}>;

/** Shown when the signed-in user's data can't be loaded: retry, or sign out as the way out. */
export function RecoveryScreen({ onRetry, onSignOut }: RecoveryScreenProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bgCanvas }]}>
      <View style={styles.body}>
        <Text variant="title2" accessibilityRole="header">
          {t('recovery.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('recovery.body')}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label={t('recovery.retry')} onPress={() => void retry()} disabled={busy} />
        <Button variant="ghost" label={t('recovery.signOut')} onPress={() => void onSignOut()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: SCREEN_PADDING, gap: spacing.md },
  actions: { padding: SCREEN_PADDING, gap: spacing.sm },
});
