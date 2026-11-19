import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { ReallocateScreen } from '@/features/budget/components/reallocate-screen';

export default function ReallocateRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return <ReallocateScreen userId={userId} base={base} initialFromId={from} onDone={() => router.back()} />;
}
