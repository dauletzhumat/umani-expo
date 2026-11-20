import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useAccounts } from '@/features/accounts/api/accounts';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { HistoryScreen } from '@/features/expenses/components/history-screen';

export default function HistoryRoute() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const accounts = useAccounts(userId, base).data ?? [];
  return (
    <HistoryScreen
      userId={userId}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      initialAccountId={account}
      onOpen={(item) =>
        router.push(
          item.kind === 'income'
            ? { pathname: '/income/[id]', params: { id: item.entryId } }
            : { pathname: '/expenses/[id]', params: { id: item.entryId } },
        )
      }
    />
  );
}
