import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/features/shell/components/placeholder-screen';

export default function AdvisorRoute() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('advisor.title')} body={t('advisor.emptyBody')} />;
}
