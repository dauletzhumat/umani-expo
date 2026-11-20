import { router, Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { AccountDetailScreen } from '@/features/accounts/components/account-detail-screen';
import { LoadState } from '@/features/accounts/components/load-state';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { Screen } from '@/ui/screen';

export default function AccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base);
  const account = accounts.data?.find((a) => a.id === id);
  if (accounts.isPending || accounts.isError) {
    return (
      <Screen>
        <LoadState failed={accounts.isError} onRetry={() => void accounts.refetch()} />
      </Screen>
    );
  }
  if (base === undefined || account === undefined) return null;
  return (
    <>
      <Stack.Screen options={{ title: account.name }} />
      <AccountDetailScreen
        account={account}
        base={base}
        onTransfer={() => router.push({ pathname: '/transfer', params: { from: account.id } })}
        onArchived={() => router.back()}
      />
    </>
  );
}
