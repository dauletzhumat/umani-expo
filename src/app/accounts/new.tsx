import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { CreateAccountScreen } from '@/features/accounts/components/create-account-screen';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';

export default function NewAccountRoute() {
  const params = useLocalSearchParams<{ name?: string; kind?: string; envelope?: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  if (base === undefined) return null;
  return (
    <CreateAccountScreen
      base={base}
      initial={{
        name: params.name,
        kind: params.kind === 'deposit' || params.kind === 'current' ? params.kind : undefined,
        linkedEnvelopeId: params.envelope,
      }}
      onDone={() => router.back()}
    />
  );
}
