import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/features/shell/components/placeholder-screen';

export default function BudgetRoute() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('budget.title')} body={t('budget.emptyBody')} />;
}
