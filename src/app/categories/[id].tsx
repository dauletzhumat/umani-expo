import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session-provider';
import { useActiveBudget } from '@/features/budget/api/use-active-budget';
import { useCategories } from '@/features/expenses/api/expenses';
import { CategoryScreen } from '@/features/expenses/components/category-screen';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

export default function EditCategoryRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const base = useActiveBudget(userId).data?.base_currency;
  const categories = useCategories(userId, true);
  if (base === undefined || categories.isPending) return null;
  const category = categories.data?.find((c) => c.id === id);
  if (category === undefined) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary" accessibilityRole="alert">
          {t('expenses.categoryNotFound')}
        </Text>
      </Screen>
    );
  }
  return <CategoryScreen userId={userId} base={base} kind={category.kind} initial={category} onDone={() => router.back()} />;
}
