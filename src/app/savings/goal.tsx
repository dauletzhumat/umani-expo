import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { useGoals, usePlanEnvelopes } from '@/features/savings/api/savings';
import { LoadState } from '@/features/accounts/components/load-state';
import { GoalScreen } from '@/features/savings/components/goal-screen';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

export default function GoalRoute() {
  const { t } = useTranslation();
  const { envelope: envelopeId } = useLocalSearchParams<{ envelope: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const envelopes = usePlanEnvelopes(userId, base);
  const goals = useGoals(userId, base);
  if (base === undefined || envelopes.isPending || goals.isPending) return null;
  // without the goals an existing goal would be edited as a new one and silently replaced
  if (envelopes.isError || goals.isError) {
    return (
      <Screen>
        <LoadState
          failed
          onRetry={() => {
            void envelopes.refetch();
            void goals.refetch();
          }}
        />
      </Screen>
    );
  }
  const envelope = envelopes.data?.find((e) => e.id === envelopeId && e.kind === 'savings');
  if (envelope === undefined) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary" accessibilityRole="alert">
          {t('savings.envelopeNotFound')}
        </Text>
      </Screen>
    );
  }
  const goal = goals.data?.find((g) => g.envelopeId === envelope.id);
  return (
    <GoalScreen
      // the form is seeded from props: a different goal is a fresh form
      key={goal?.id ?? 'new'}
      base={base}
      envelope={envelope}
      goal={goal}
      onDone={() => router.back()}
    />
  );
}
