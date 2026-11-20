import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useIncomeEntry } from '@/features/budget/api/budget';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { IncomeScreen } from '@/features/budget/components/income-screen';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

export default function EditIncomeRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base).data;
  const details = useIncomeEntry(
    userId,
    id,
    (accounts ?? []).map((a) => a.id),
  );
  if (base === undefined || accounts === undefined || details.isPending) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary">
          {t('budget.loading')}
        </Text>
      </Screen>
    );
  }
  if (details.data === null || details.data === undefined) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary" accessibilityRole="alert">
          {t('budget.notFound')}
        </Text>
      </Screen>
    );
  }
  const { entry, parts, rate } = details.data;
  return (
    <IncomeScreen
      userId={userId}
      base={base}
      accounts={accounts
        .filter((a) => !a.archived || a.id === entry.accountId)
        .map((a) => ({ id: a.id, name: a.name, currency: a.currency, includeInBudget: a.includeInBudget }))}
      initial={entry}
      initialParts={parts}
      initialRate={rate}
      onDone={() => router.back()}
    />
  );
}
