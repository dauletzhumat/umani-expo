import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/features/shell/components/placeholder-screen';

export default function StatsRoute() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('stats.title')} body={t('stats.emptyBody')} />;
}
