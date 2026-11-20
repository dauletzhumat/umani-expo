import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isNegative, isPositive } from '@/domain/money/money';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { ChipGroup } from '@/ui/chip-group';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';

import { useCategories, useHistory } from '../api/expenses';
import { formatDay, type HistoryItem } from '../model/expense';
import { categoryLabel } from './labels';

const ALL = 'all';
const PAGE = 50;

export type HistoryScreenProps = Readonly<{
  userId: string | null;
  accounts: readonly Readonly<{ id: string; name: string }>[];
  initialAccountId?: string;
  /** Income and expenses open their edit screen; other kinds are read-only here. */
  onOpen: (item: HistoryItem) => void;
}>;

export const isEditable = (item: HistoryItem) => item.kind === 'expense' || item.kind === 'income';

/** Transaction history (EXP-5) with the account switcher (ACC-5); reversed pairs are hidden. */
export function HistoryScreen({ userId, accounts, initialAccountId, onOpen }: HistoryScreenProps) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState<string>(
    initialAccountId !== undefined && accounts.some((a) => a.id === initialAccountId) ? initialAccountId : ALL,
  );
  const [limit, setLimit] = useState(PAGE);
  const history = useHistory(userId, accountId === ALL ? null : accountId, limit);
  const categories = useCategories(userId);
  const items = history.data ?? [];

  return (
    <Screen>
      <ChipGroup
        accessibilityLabel={t('expenses.accountFilter')}
        value={accountId}
        onChange={(id) => {
          setAccountId(id);
          setLimit(PAGE);
        }}
        chips={[{ value: ALL, label: t('expenses.allAccounts') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
      />
      {history.isError && (
        <Text variant="footnote" color="negative" accessibilityRole="alert">
          {t('expenses.error_failed')}
        </Text>
      )}
      <Surface padded={false}>
        {items.length === 0 ? (
          <ListRow title={history.isPending ? t('expenses.loading') : t('expenses.noHistory')} />
        ) : (
          items.map((item) => {
            const category = categories.data?.find((c) => c.id === item.categoryId);
            const account = accounts.find((a) => a.id === item.accountId);
            return (
              <ListRow
                key={item.key}
                title={category === undefined ? t(`expenses.entryKind_${item.kind}`) : categoryLabel(category, t)}
                subtitle={[formatDay(item.occurredOn), account?.name, item.note].filter(Boolean).join(' · ')}
                trailing={<AmountText money={item.amount} mode={isPositive(item.amount) ? 'income' : isNegative(item.amount) ? 'expense' : 'neutral'} />}
                onPress={isEditable(item) ? () => onOpen(item) : undefined}
              />
            );
          })
        )}
      </Surface>
      {items.length >= limit && (
        <Button label={t('expenses.showMore')} variant="secondary" onPress={() => setLimit(limit + PAGE)} />
      )}
    </Screen>
  );
}
