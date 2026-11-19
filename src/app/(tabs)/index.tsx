import { useSession } from '@/features/auth/session-provider';
import { AccountsSummary } from '@/features/accounts/components/accounts-summary';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { HomeScreen } from '@/features/home/components/home-screen';

export default function HomeRoute() {
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  return <HomeScreen accounts={base === undefined ? null : <AccountsSummary userId={userId} base={base} />} />;
}
