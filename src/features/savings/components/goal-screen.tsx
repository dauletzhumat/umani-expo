import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { formatAmount, formatMoney } from '@/domain/money/format';
import { isPositive } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { requiredMonthly } from '@/domain/savings/savings';
import { Button } from '@/ui/button';
import { ChipGroup } from '@/ui/chip-group';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import { archiveSavingsGoal, setSavingsGoal, useRefreshAfterGoalWrite } from '../api/savings';
import {
  formatDay,
  GOAL_HORIZONS,
  horizonDate,
  todayIso,
  type Goal,
  type GoalHorizon,
  type PlanEnvelope,
  type SavingsError,
} from '../model/savings';
import { envelopeName, localeOf } from './savings-screen';

export type GoalScreenProps = Readonly<{
  base: CurrencyCode;
  envelope: PlanEnvelope;
  /** The envelope's active goal, when editing. */
  goal?: Goal;
  onDone: () => void;
}>;

/** Set, change or remove the goal of a savings envelope (BUD-7). */
export function GoalScreen({ base, envelope, goal, onDone }: GoalScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterGoalWrite();
  const today = todayIso();

  const [amountText, setAmountText] = useState(goal === undefined ? '' : formatAmount(goal.target, locale));
  // an existing date stays as it is until the user picks another horizon
  // (a date that has passed can't be saved again, so an overdue goal starts from a new horizon)
  const [horizon, setHorizon] = useState<GoalHorizon | 'keep'>(
    goal === undefined || (goal.targetDate !== null && goal.targetDate < today)
      ? '12'
      : goal.targetDate === null
        ? 'none'
        : 'keep',
  );
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<SavingsError | null>(null);
  const [saving, setSaving] = useState(false);

  const targetDate = horizon === 'keep' ? (goal?.targetDate ?? null) : horizonDate(today, horizon);
  const parsed = amountText.trim() === '' ? null : parseMoney(amountText, base, locale);
  const target = parsed?.ok === true && isPositive(parsed.value) ? parsed.value : null;
  const need = target === null ? null : requiredMonthly(target, envelope.balance, today, targetDate);

  async function save() {
    if (target === null) {
      setFieldError(t('savings.invalidAmount'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setSaving(true);
    const result = await setSavingsGoal(envelope.id, target, targetDate);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    await refresh();
    onDone();
  }

  function confirmRemove() {
    if (goal === undefined) return;
    Alert.alert(t('savings.removeGoalTitle'), t('savings.removeGoalMessage'), [
      { text: t('savings.cancel'), style: 'cancel' },
      {
        text: t('savings.removeGoal'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void archiveSavingsGoal(goal.id).then(async (result) => {
            if (!result.ok) {
              setSaving(false);
              setError(result.error);
              return;
            }
            await refresh();
            onDone();
          });
        },
      },
    ]);
  }

  return (
    <Screen>
      <Text variant="headline">{envelopeName(envelope, t)}</Text>
      <Text variant="footnote" color="textSecondary">
        {t('savings.envelopeHas', { amount: formatMoney(envelope.balance, locale) })}
      </Text>
      <TextField
        label={t('savings.goalAmount', { currency: base })}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0"
        autoFocus={goal === undefined}
        error={fieldError}
      />
      <Text variant="footnote" color="textSecondary">
        {t('savings.goalBy')}
      </Text>
      <ChipGroup
        accessibilityLabel={t('savings.goalBy')}
        value={horizon === 'keep' ? null : horizon}
        onChange={setHorizon}
        chips={GOAL_HORIZONS.map((h) => ({
          value: h,
          label: h === 'none' ? t('savings.noDate') : t('savings.inMonths', { count: Number(h) }),
        }))}
      />
      {targetDate !== null && (
        <Text variant="footnote" color="textSecondary">
          {t('savings.byDate', { date: formatDay(targetDate) })}
        </Text>
      )}
      {need !== null && (
        <Text variant="callout" accessibilityLiveRegion="polite">
          {need.kind === 'reached'
            ? t('savings.goalReached')
            : need.kind === 'monthly'
              ? t('savings.needMonthly', { amount: formatMoney(need.amount, locale), count: need.months })
              : need.kind === 'overdue'
                ? t('savings.goalOverdue', { amount: formatMoney(need.missing, locale) })
                : t('savings.goalMissing', { amount: formatMoney(need.missing, locale) })}
        </Text>
      )}
      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`savings.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('savings.saving') : t('savings.save')} disabled={saving} onPress={() => void save()} />
      {goal !== undefined && (
        <Button label={t('savings.removeGoal')} variant="destructive" disabled={saving} onPress={confirmRemove} />
      )}
    </Screen>
  );
}
