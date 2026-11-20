import { router } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { LoadState } from '@/features/accounts/components/load-state';
import { SavingsScreen } from '@/features/savings/components/savings-screen';
import { Screen } from '@/ui/screen';

export default function SavingsRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base);
  if (base === undefined) return null;
  // the plan hides "I've opened it" for envelopes with a deposit: wait for the accounts first,
  // or a slow load would offer to open the same deposit twice
  if (accounts.isPending || accounts.isError) {
    return (
      <Screen>
        <LoadState failed={accounts.isError} onRetry={() => void accounts.refetch()} />
      </Screen>
    );
  }
  return (
    <SavingsScreen
      userId={userId}
      base={base}
      accounts={accounts.data
        .filter((a) => !a.archived)
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind, linkedEnvelopeId: a.linkedEnvelopeId, balance: a.balance }))}
      onOpenDeposit={(envelope, name) =>
        router.push({ pathname: '/accounts/new', params: { kind: 'deposit', name, envelope } })
      }
      onOpenEverydayAccount={(name) => router.push({ pathname: '/accounts/new', params: { kind: 'current', name } })}
      onContribute={(to) => router.push({ pathname: '/transfer', params: { to } })}
      onEditGoal={(envelope) => router.push({ pathname: '/savings/goal', params: { envelope } })}
    />
  );
}
