import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { BudgetMethod } from '@/domain/allocation/envelope';
import type { CurrencyCode } from '@/domain/money/currency';
import { formatMoney } from '@/domain/money/format';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/tokens';

import { useEnvelopes, useIncomeCategories, useRecentIncome } from '../api/budget';
import { bpsLabel, formatDay, type AccountOption } from '../model/budget';
import { categoryLabel, envelopeLabel, localeOf } from './labels';

export type BudgetScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  method: BudgetMethod;
  accounts: readonly AccountOption[];
  onAddIncome: () => void;
  onEditIncome: (entryId: string) => void;
  onReallocate: (fromEnvelopeId?: string) => void;
  onChangeMethod: () => void;
}>;

/** Budget tab: envelopes with balances, the Unallocated prompt and recent income (BUD-5, BUD-6). */
export function BudgetScreen({
  userId,
  base,
  method,
  accounts,
  onAddIncome,
  onEditIncome,
  onReallocate,
  onChangeMethod,
}: BudgetScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const envelopes = useEnvelopes(userId, base);
  const categories = useIncomeCategories(userId);
  const income = useRecentIncome(
    userId,
    accounts.map((a) => a.id),
  );

  const unallocated = envelopes.data?.find((e) => e.kind === 'unallocated');
  const methodLabel = method === 'custom' ? t('budget.methodCustom') : t(`onboarding.method_${method}`);

  return (
    <Screen title={t('budget.title')}>
      <Surface padded={false}>
        <ListRow title={t('budget.method', { method: methodLabel })} onPress={onChangeMethod} />
      </Surface>

      {unallocated !== undefined && unallocated.balance.amountMinor !== 0n && (
        <Surface style={styles.group}>
          <Text variant="headline">
            {t('budget.unallocatedTitle', { amount: formatMoney(unallocated.balance, locale) })}
          </Text>
          {unallocated.balance.amountMinor > 0n && (
            <>
              <Text variant="callout" color="textSecondary">
                {t('budget.unallocatedBody')}
              </Text>
              <Button label={t('budget.assign')} variant="secondary" onPress={() => onReallocate(unallocated.id)} />
            </>
          )}
        </Surface>
      )}

      <Surface padded={false}>
        {(envelopes.data ?? [])
          .filter((e) => e.kind !== 'unallocated')
          .map((envelope) => (
            <ListRow
              key={envelope.id}
              title={envelopeLabel(envelope, t)}
              subtitle={t('budget.share', { percent: bpsLabel(envelope.allocationBps, locale) })}
              trailing={<AmountText money={envelope.balance} mode={envelope.balance.amountMinor < 0n ? 'expense' : 'neutral'} />}
              onPress={() => onReallocate(envelope.id)}
            />
          ))}
      </Surface>

      <View style={styles.group}>
        <Button label={t('budget.addIncome')} onPress={onAddIncome} />
        <Button label={t('budget.reallocate')} variant="secondary" onPress={() => onReallocate()} />
      </View>

      <Text variant="headline" accessibilityRole="header">
        {t('budget.recentIncome')}
      </Text>
      <Surface padded={false}>
        {(income.data ?? []).length === 0 ? (
          <ListRow title={t('budget.noIncome')} />
        ) : (
          (income.data ?? []).map((entry) => {
            const category = categories.data?.find((c) => c.id === entry.categoryId);
            const account = accounts.find((a) => a.id === entry.accountId);
            return (
              <ListRow
                key={entry.id}
                title={category === undefined ? (account?.name ?? '') : categoryLabel(category, t)}
                subtitle={[formatDay(entry.occurredOn), account?.name, entry.note].filter(Boolean).join(' · ')}
                trailing={<AmountText money={entry.amount} mode="income" />}
                onPress={() => onEditIncome(entry.id)}
              />
            );
          })
        )}
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
