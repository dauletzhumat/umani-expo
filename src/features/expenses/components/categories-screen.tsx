import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/domain/money/currency';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';

import { useCategories, useSpendEnvelopes } from '../api/expenses';
import type { CategoryKind } from '../model/expense';
import { categoryLabel, envelopeLabel } from './labels';

export type CategoriesScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  onOpen: (categoryId: string) => void;
  onNew: (kind: CategoryKind) => void;
}>;

/** Categories (EXP-2): defaults and the user's own, each expense category with its default envelope. */
export function CategoriesScreen({ userId, base, onOpen, onNew }: CategoriesScreenProps) {
  const { t } = useTranslation();
  const categories = useCategories(userId);
  const envelopes = useSpendEnvelopes(userId, base);
  const [kind, setKind] = useState<CategoryKind>('expense');
  const list = (categories.data ?? []).filter((c) => c.kind === kind);

  return (
    <Screen>
      <SegmentedControl
        accessibilityLabel={t('expenses.categoryKind')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: t('expenses.kindExpense') },
          { value: 'income', label: t('expenses.kindIncome') },
        ]}
      />
      {categories.isError && (
        <Text variant="footnote" color="negative" accessibilityRole="alert">
          {t('expenses.error_failed')}
        </Text>
      )}
      <Surface padded={false}>
        {list.map((category) => {
          const envelope = envelopes.data?.find((e) => e.id === category.defaultEnvelopeId);
          return (
            <ListRow
              key={category.id}
              title={categoryLabel(category, t)}
              subtitle={
                kind === 'expense'
                  ? envelope === undefined
                    ? t('expenses.noDefaultEnvelope')
                    : t('expenses.defaultEnvelope', { envelope: envelopeLabel(envelope, t) })
                  : undefined
              }
              onPress={() => onOpen(category.id)}
            />
          );
        })}
      </Surface>
      <Button label={t('expenses.newCategory')} variant="secondary" onPress={() => onNew(kind)} />
    </Screen>
  );
}
