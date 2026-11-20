import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { formatMoney } from '@/domain/money/format';
import { isNegative } from '@/domain/money/money';
import { averageMonthlyIncome, goalProgress, requiredMonthly } from '@/domain/savings/savings';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme/theme-provider';
import { radius, spacing } from '@/ui/tokens';

import { useGoals, useMonthlyIncome, usePlanEnvelopes } from '../api/savings';
import { buildDepositPlan, formatDay, todayIso, type Goal, type PlanAccount, type PlanItem } from '../model/savings';

const ENVELOPE_KEYS = [
  'envelope.needs',
  'envelope.wants',
  'envelope.savings',
  'envelope.spending',
  'envelope.living',
  'envelope.debtGiving',
  'envelope.unallocated',
] as const;

/** Preset envelopes are i18n keys; custom ones carry their own name. */
export function envelopeName(envelope: Readonly<{ name: string | null; nameKey: string | null }>, t: TFunction): string {
  const key = ENVELOPE_KEYS.find((k) => k === envelope.nameKey);
  return key === undefined ? (envelope.name ?? '') : t(key);
}

export function localeOf(language: string): 'ru' | 'kk' | 'en' {
  return language === 'kk' || language === 'en' ? language : 'ru';
}

export type SavingsScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  accounts: readonly PlanAccount[];
  /** Mark a recommendation as opened (DEP-3): create a deposit linked to the envelope. */
  onOpenDeposit: (envelopeId: string, suggestedName: string) => void;
  onOpenEverydayAccount: (suggestedName: string) => void;
  /** A contribution is a transfer into the deposit (DEP-4). */
  onContribute: (accountId: string) => void;
  onEditGoal: (envelopeId: string) => void;
}>;

function ProgressBar({ permille, reached }: Readonly<{ permille: number; reached: boolean }>) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.track, { backgroundColor: colors.bgSurfaceRaised }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <View style={[styles.fill, { width: `${permille / 10}%`, backgroundColor: reached ? colors.positive : colors.accent }]} />
    </View>
  );
}

/** Deposits planner and savings goals (PRD DEP-1…4, BUD-7). Education, not product advice. */
export function SavingsScreen({
  userId,
  base,
  accounts,
  onOpenDeposit,
  onOpenEverydayAccount,
  onContribute,
  onEditGoal,
}: SavingsScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const envelopes = usePlanEnvelopes(userId, base);
  const goals = useGoals(userId, base);
  const income = useMonthlyIncome(userId, base);
  const today = todayIso();

  const average = income.data === undefined ? null : averageMonthlyIncome(income.data, today, base);
  const plan = buildDepositPlan(envelopes.data ?? [], accounts, average);
  const failed = envelopes.isError || goals.isError || income.isError;

  function goalBlock(item: PlanItem, goal: Goal | undefined) {
    if (goal === undefined) {
      return (
        <Button
          label={t('savings.setGoal')}
          accessibilityHint={envelopeName(item.envelope, t)}
          variant="secondary"
          onPress={() => onEditGoal(item.envelope.id)}
        />
      );
    }
    const progress = goalProgress(goal.target, item.envelope.balance);
    const need = requiredMonthly(goal.target, item.envelope.balance, today, goal.targetDate);
    const needText =
      need.kind === 'reached'
        ? t('savings.goalReached')
        : need.kind === 'monthly'
          ? t('savings.needMonthly', { amount: formatMoney(need.amount, locale), count: need.months })
          : need.kind === 'overdue'
            ? t('savings.goalOverdue', { amount: formatMoney(need.missing, locale) })
            : t('savings.goalMissing', { amount: formatMoney(need.missing, locale) });
    return (
      <Surface padded={false}>
        <ListRow
          title={t('savings.goalOf', {
            saved: formatMoney(item.envelope.balance, locale),
            target: formatMoney(goal.target, locale),
          })}
          subtitle={[goal.targetDate === null ? null : t('savings.byDate', { date: formatDay(goal.targetDate) }), needText]
            .filter(Boolean)
            .join(' · ')}
          onPress={() => onEditGoal(item.envelope.id)}
        />
        <View style={styles.bar}>
          <ProgressBar permille={progress.permille} reached={progress.reached} />
        </View>
      </Surface>
    );
  }

  return (
    <Screen>
      <Surface style={styles.group}>
        <Text variant="headline">{t('savings.whyTitle')}</Text>
        <Text variant="callout" color="textSecondary">
          {t('savings.whyBody')}
        </Text>
        <Text variant="callout" color="textSecondary">
          {t('savings.lookFor')}
        </Text>
        <Text variant="footnote" color="textTertiary">
          {t('savings.noEndorsement')}
        </Text>
      </Surface>

      {failed && (
        <Text variant="footnote" color="negative" accessibilityRole="alert">
          {t('savings.loadFailed')}
        </Text>
      )}
      <Text variant="footnote" color="textSecondary">
        {average === null ? t('savings.noIncome') : t('savings.averageIncome', { amount: formatMoney(average, locale) })}
      </Text>

      {envelopes.data !== undefined && plan.savings.length === 0 && (
        <Text variant="callout" color="textSecondary">
          {t('savings.noSavingsEnvelope')}
        </Text>
      )}

      {plan.savings.map((item) => {
        const label = envelopeName(item.envelope, t);
        const suggestedName = `UMANI · ${label}`;
        const goal = goals.data?.find((g) => g.envelopeId === item.envelope.id);
        return (
          <View key={item.envelope.id} style={styles.group}>
            <Text variant="headline" accessibilityRole="header">
              {label}
            </Text>
            <Surface padded={false}>
              <ListRow
                title={t('savings.envelopeBalance')}
                trailing={
                  <AmountText money={item.envelope.balance} mode={isNegative(item.envelope.balance) ? 'expense' : 'neutral'} />
                }
              />
              <ListRow
                title={t('savings.expectedMonthly')}
                value={item.expected === null ? '—' : formatMoney(item.expected, locale)}
              />
              {item.accounts.map((account) => (
                <ListRow
                  key={account.id}
                  title={account.name}
                  subtitle={t('savings.contribute')}
                  trailing={<AmountText money={account.balance} />}
                  onPress={() => onContribute(account.id)}
                />
              ))}
            </Surface>
            {item.accounts.length === 0 && (
              <>
                <Text variant="footnote" color="textSecondary">
                  {t('savings.recommendation', { name: suggestedName })}
                </Text>
                <Button
                  label={t('savings.markOpened')}
                  accessibilityHint={suggestedName}
                  onPress={() => onOpenDeposit(item.envelope.id, suggestedName)}
                />
              </>
            )}
            {goalBlock(item, goal)}
          </View>
        );
      })}

      {envelopes.data !== undefined && plan.spending !== null && (
        <View style={styles.group}>
          <Text variant="headline" accessibilityRole="header">
            {t('savings.everydayTitle')}
          </Text>
          <Text variant="callout" color="textSecondary">
            {plan.spending.expected === null
              ? t('savings.everydayBody')
              : t('savings.everydayBodyAmount', { amount: formatMoney(plan.spending.expected, locale) })}
          </Text>
          <Button
            label={t('savings.markOpened')}
            variant="secondary"
            onPress={() => onOpenEverydayAccount(t('savings.everydayName'))}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  bar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  track: { height: 6, borderRadius: radius.sm, overflow: 'hidden' },
  fill: { height: 6 },
});
