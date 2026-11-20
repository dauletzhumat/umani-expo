import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { ExpenseScreen } from '@/features/expenses/components/expense-screen';

export default function NewExpenseRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base).data;
  if (base === undefined || accounts === undefined) return null;
  return (
    <ExpenseScreen
      userId={userId}
      base={base}
      accounts={accounts
        .filter((a) => !a.archived)
        .map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          includeInBudget: a.includeInBudget,
          balance: a.balance,
          bookValue: a.bookValue,
        }))}
      onManageCategories={() => router.push('/categories')}
      onDone={() => router.back()}
    />
  );
}
