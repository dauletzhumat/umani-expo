import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { approximateTotal } from '@/domain/fx/approximate-total';
import type { CurrencyCode } from '@/domain/money/currency';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/tokens';

import { useAccounts, useRatesToBase } from '../api/accounts';
import type { Account } from '../model/account';
import { LoadState } from './load-state';

export type AccountsSummaryProps = Readonly<{ userId: string | null; base: CurrencyCode }>;

/** Home: total in the base currency (≈ when foreign balances are converted) and the accounts list. */
export function AccountsSummary({ userId, base }: AccountsSummaryProps) {
  const { t } = useTranslation();
  const subtitle = (account: Account) => {
    const kind = t(`accounts.kind_${account.kind}`);
    return account.includeInBudget ? kind : `${kind} · ${t('accounts.outsideBudget')}`;
  };
  const accounts = useAccounts(userId, base);
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const { rates, loading: ratesLoading } = useRatesToBase(
    active.map((a) => a.currency),
    base,
  );
  const total = approximateTotal(
    active.map((a) => a.balance),
    base,
    rates,
  );

  if (accounts.isPending || accounts.isError) {
    return <LoadState failed={accounts.isError} onRetry={() => void accounts.refetch()} />;
  }

  return (
    <>
      <Surface style={styles.balance}>
        <Text variant="subhead" color="textSecondary">
          {t('home.totalBalance')}
        </Text>
        {ratesLoading ? (
          <Text variant="display" color="textTertiary" accessibilityLabel={t('accounts.loading')}>
            …
          </Text>
        ) : (
          <View style={styles.totalRow}>
            {!ratesLoading && total.approximate && (
              <Text variant="display" accessibilityLabel={t('accounts.approximately')}>
                ≈
              </Text>
            )}
            <AmountText money={total.total} variant="display" hideZeroFraction />
          </View>
        )}
        {total.approximate && (
          <Text variant="footnote" color="textSecondary">
            {t('accounts.approxNote')}
          </Text>
        )}
        {!ratesLoading && total.unconverted.length > 0 && (
          <Text variant="footnote" color="textSecondary">
            {t('accounts.unconverted', { currencies: total.unconverted.join(', ') })}
          </Text>
        )}
      </Surface>

      <Text variant="headline" accessibilityRole="header">
        {t('accounts.title')}
      </Text>
      <Surface padded={false}>
        {active.map((account) => (
          <ListRow
            key={account.id}
            title={account.name}
            subtitle={subtitle(account)}
            trailing={<AmountText money={account.balance} />}
            onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })}
          />
        ))}
      </Surface>
      <View style={styles.actions}>
        <Button label={t('accounts.add')} variant="secondary" onPress={() => router.push('/accounts/new')} />
        {active.length >= 2 && (
          <Button label={t('accounts.transfer')} variant="secondary" onPress={() => router.push('/transfer')} />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  balance: { gap: spacing.xs },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  actions: { gap: spacing.sm },
});
