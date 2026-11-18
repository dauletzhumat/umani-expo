import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { money } from '@/domain/money/money';
import { AmountText } from '@/ui/amount-text';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/tokens';

/** Home shell: total balance placeholder (0 until accounts exist in M3) and a way to Settings. */
export function HomeScreen() {
  const { t } = useTranslation();
  return (
    <Screen title={t('home.title')}>
      <Surface style={styles.balance}>
        <Text variant="subhead" color="textSecondary">
          {t('home.totalBalance')}
        </Text>
        <AmountText money={money(0n, 'KZT')} variant="display" hideZeroFraction />
      </Surface>

      <Surface style={styles.empty}>
        <Text variant="headline">{t('home.emptyTitle')}</Text>
        <Text variant="callout" color="textSecondary">
          {t('home.emptyBody')}
        </Text>
      </Surface>

      <Surface padded={false}>
        <ListRow title={t('home.settings')} onPress={() => router.push('/settings')} />
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { gap: spacing.xs },
  empty: { gap: spacing.sm },
});
