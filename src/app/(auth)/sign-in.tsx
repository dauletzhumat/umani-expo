import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/features/shell/components/placeholder-screen';

/** Placeholder; Apple and Google sign-in arrive in M2 together with auth gating. */
export default function SignInRoute() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('auth.title')} body={t('auth.emptyBody')} />;
}
