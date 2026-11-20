import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { formatMoney } from '@/domain/money/format';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme/theme-provider';
import { radius, spacing } from '@/ui/tokens';

import { useCategories, useLimitProgress, useSpendEnvelopes } from '../api/expenses';
import { monthStart, todayIso, type LimitProgress } from '../model/expense';
import { categoryLabel, envelopeLabel, localeOf } from './labels';

export type LimitsSectionProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  onAddLimit: () => void;
  onOpenLimit: (limitId: string) => void;
  onManageCategories: () => void;
}>;

function ProgressBar({ progress }: Readonly<{ progress: LimitProgress }>) {
  const { colors } = useTheme();
  const fill = progress.state === 'over' ? colors.negative : progress.state === 'near' ? colors.warning : colors.accent;
  return (
    <View
      style={[styles.track, { backgroundColor: colors.bgSurfaceRaised }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <View style={[styles.fill, { width: `${progress.permille / 10}%`, backgroundColor: fill }]} />
    </View>
  );
}

/** Monthly limits with progress (EXP-4), shown on the Budget tab. */
export function LimitsSection({ userId, base, onAddLimit, onOpenLimit, onManageCategories }: LimitsSectionProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const progress = useLimitProgress(userId, base, monthStart(todayIso()));
  const envelopes = useSpendEnvelopes(userId, base);
  const categories = useCategories(userId);

  function targetLabel(item: LimitProgress): string {
    if (item.envelopeId !== null) {
      const envelope = envelopes.data?.find((e) => e.id === item.envelopeId);
      return envelope === undefined ? t('expenses.unavailable') : envelopeLabel(envelope, t);
    }
    const category = categories.data?.find((c) => c.id === item.categoryId);
    return category === undefined ? t('expenses.unavailable') : categoryLabel(category, t);
  }

  const items = progress.data ?? [];
  return (
    <View style={styles.group}>
      <Text variant="headline" accessibilityRole="header">
        {t('expenses.limitsTitle')}
      </Text>
      {progress.isError && (
        <Text variant="footnote" color="negative" accessibilityRole="alert">
          {t('expenses.error_failed')}
        </Text>
      )}
      <Surface padded={false}>
        {items.length === 0 ? (
          <ListRow title={t('expenses.noLimits')} />
        ) : (
          items.map((item) => {
            const label = targetLabel(item);
            const spent = formatMoney(item.spent, locale);
            const limit = formatMoney(item.limit, locale);
            const status = t(`expenses.limitState_${item.state}`);
            return (
              <View key={item.limitId}>
                <ListRow
                  title={label}
                  subtitle={`${t('expenses.limitSpent', { spent, limit })} · ${status}`}
                  onPress={() => onOpenLimit(item.limitId)}
                />
                <View style={styles.bar}>
                  <ProgressBar progress={item} />
                </View>
              </View>
            );
          })
        )}
      </Surface>
      <Button label={t('expenses.addLimit')} variant="secondary" onPress={onAddLimit} />
      <Surface padded={false}>
        <ListRow title={t('expenses.manageCategories')} onPress={onManageCategories} />
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  bar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  track: { height: 6, borderRadius: radius.sm, overflow: 'hidden' },
  fill: { height: 6 },
});
