import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { useExpenseEntry } from '@/features/expenses/api/expenses';
import { ExpenseScreen } from '@/features/expenses/components/expense-screen';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

export default function EditExpenseRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base).data;
  const entry = useExpenseEntry(userId, id);
  if (base === undefined || accounts === undefined || entry.isPending) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary">
          {t('expenses.loading')}
        </Text>
      </Screen>
    );
  }
  if (entry.data === null || entry.data === undefined) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary" accessibilityRole="alert">
          {t('expenses.notFound')}
        </Text>
      </Screen>
    );
  }
  const initial = entry.data;
  return (
    <ExpenseScreen
      userId={userId}
      base={base}
      accounts={accounts
        .filter((a) => !a.archived || a.id === initial.accountId)
        .map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          includeInBudget: a.includeInBudget,
          balance: a.balance,
          bookValue: a.bookValue,
        }))}
      initial={initial}
      onManageCategories={() => router.push('/categories')}
      onDone={() => router.back()}
    />
  );
}
