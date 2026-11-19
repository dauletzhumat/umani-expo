import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';

export type HomeScreenProps = Readonly<{
  /** The accounts summary (total + list), composed by the route from the accounts feature. */
  accounts: ReactNode;
}>;

/** Home: accounts summary and a way to Settings. */
export function HomeScreen({ accounts }: HomeScreenProps) {
  const { t } = useTranslation();
  return (
    <Screen title={t('home.title')}>
      {accounts}

      <Surface padded={false}>
        <ListRow title={t('home.settings')} onPress={() => router.push('/settings')} />
      </Surface>
    </Screen>
  );
}
