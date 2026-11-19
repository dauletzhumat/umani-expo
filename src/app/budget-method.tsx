import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { MethodScreen } from '@/features/budget/components/method-screen';

export default function BudgetMethodRoute() {
  const { userId } = useSession();
  const budget = useActiveBudget(userId).data;
  if (budget === undefined || budget === null) return null;
  return <MethodScreen userId={userId} base={budget.base_currency} current={budget.method} onDone={() => router.back()} />;
}
