import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { BudgetScreen } from '@/features/budget/components/budget-screen';

export default function BudgetRoute() {
  const { userId } = useSession();
  const budget = useActiveBudget(userId).data;
  const accounts = useAccounts(userId, budget?.base_currency).data ?? [];
  if (budget === undefined || budget === null) return null;
  return (
    <BudgetScreen
      userId={userId}
      base={budget.base_currency}
      method={budget.method}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, includeInBudget: a.includeInBudget }))}
      onAddIncome={() => router.push('/income/new')}
      onEditIncome={(id) => router.push({ pathname: '/income/[id]', params: { id } })}
      onReallocate={(from) => router.push(from === undefined ? '/reallocate' : { pathname: '/reallocate', params: { from } })}
      onChangeMethod={() => router.push('/budget-method')}
    />
  );
}
