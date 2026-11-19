import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Button } from '@/ui/button';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/tokens';

export type LoadStateProps = Readonly<{ failed: boolean; onRetry: () => void }>;

/** Loading or failed accounts data: never a misleading zero or an empty screen. */
export function LoadState({ failed, onRetry }: LoadStateProps) {
  const { t } = useTranslation();
  if (!failed) {
    return (
      <Surface>
        <Text variant="callout" color="textSecondary" accessibilityRole="progressbar">
          {t('accounts.loading')}
        </Text>
      </Surface>
    );
  }
  return (
    <Surface style={styles.group}>
      <Text variant="callout" accessibilityRole="alert">
        {t('accounts.loadError')}
      </Text>
      <Button label={t('accounts.retry')} variant="secondary" onPress={onRetry} />
    </Surface>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
