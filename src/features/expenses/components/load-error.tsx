import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

/** Shown when a picker's data (categories, envelopes) failed to load, so the form is not a dead end. */
export function LoadError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const { t } = useTranslation();
  return (
    <>
      <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
        {t('expenses.loadFailed')}
      </Text>
      <Button label={t('expenses.retry')} variant="secondary" onPress={onRetry} />
    </>
  );
}
