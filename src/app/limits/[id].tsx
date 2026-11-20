import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { useLimitProgress } from '@/features/expenses/api/expenses';
import { LimitScreen } from '@/features/expenses/components/limit-screen';
import { monthStart, todayIso } from '@/features/expenses/model/expense';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

export default function EditLimitRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const progress = useLimitProgress(userId, base, monthStart(todayIso()), true);
  if (base === undefined || progress.isPending) return null;
  const limit = progress.data?.find((l) => l.limitId === id);
  if (limit === undefined) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary" accessibilityRole="alert">
          {t('expenses.limitNotFound')}
        </Text>
      </Screen>
    );
  }
  return <LimitScreen userId={userId} base={base} initial={limit} onDone={() => router.back()} />;
}
