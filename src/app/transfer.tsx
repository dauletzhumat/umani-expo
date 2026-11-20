import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { TransferScreen } from '@/features/accounts/components/transfer-screen';
import { LoadState } from '@/features/accounts/components/load-state';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { Screen } from '@/ui/screen';

export default function TransferRoute() {
  const { from, to } = useLocalSearchParams<{ from?: string; to?: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const query = useAccounts(userId, base);
  if (query.isPending || query.isError) {
    return (
      <Screen>
        <LoadState failed={query.isError} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  const accounts = query.data.filter((a) => !a.archived);
  return <TransferScreen userId={userId} accounts={accounts} initialFromId={from} initialToId={to} onDone={() => router.back()} />;
}
