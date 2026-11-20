import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { CategoryScreen } from '@/features/expenses/components/category-screen';

export default function NewCategoryRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return (
    <CategoryScreen userId={userId} base={base} kind={kind === 'income' ? 'income' : 'expense'} onDone={() => router.back()} />
  );
}
