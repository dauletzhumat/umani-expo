import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { LimitScreen } from '@/features/expenses/components/limit-screen';

export default function NewLimitRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return <LimitScreen userId={userId} base={base} onDone={() => router.back()} />;
}
