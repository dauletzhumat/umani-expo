import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { CreateAccountScreen } from '@/features/accounts/components/create-account-screen';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';

export default function NewAccountRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return <CreateAccountScreen base={base} onDone={() => router.back()} />;
}
