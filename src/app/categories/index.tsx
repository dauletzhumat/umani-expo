import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { CategoriesScreen } from '@/features/expenses/components/categories-screen';

export default function CategoriesRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return (
    <CategoriesScreen
      userId={userId}
      base={base}
      onOpen={(id) => router.push({ pathname: '/categories/[id]', params: { id } })}
      onNew={(kind) => router.push({ pathname: '/categories/new', params: { kind } })}
    />
  );
}
