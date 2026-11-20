import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { formatAmount } from '@/domain/money/format';
import { isPositive } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { Button } from '@/ui/button';
import { ChipGroup } from '@/ui/chip-group';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import {
  deleteLimit,
  setLimit,
  useCategories,
  useRefreshAfterSetupWrite,
  useSpendEnvelopes,
  type LimitTarget,
} from '../api/expenses';
import type { ExpenseError, LimitProgress } from '../model/expense';
import { LoadError } from './load-error';
import { categoryLabel, envelopeLabel, localeOf } from './labels';

export type LimitScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  /** Set when editing: the target is fixed, the amount can change, the limit can be removed. */
  initial?: LimitProgress;
  onDone: () => void;
}>;

/** A recurring monthly limit for an envelope or an expense category (EXP-4). */
export function LimitScreen({ userId, base, initial, onDone }: LimitScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterSetupWrite();
  const envelopes = useSpendEnvelopes(userId, base);
  const categories = useCategories(userId);

  const [targetKind, setTargetKind] = useState<'envelope' | 'category'>(
    initial?.categoryId !== null && initial?.categoryId !== undefined ? 'category' : 'envelope',
  );
  const [targetId, setTargetId] = useState<string | null>(initial?.envelopeId ?? initial?.categoryId ?? null);
  const [amountText, setAmountText] = useState(initial === undefined ? '' : formatAmount(initial.limit, locale));
  const [fieldError, setFieldError] = useState<{ amount?: string; target?: string }>({});
  const [error, setError] = useState<ExpenseError | null>(null);
  const [saving, setSaving] = useState(false);

  const targets =
    targetKind === 'envelope'
      ? (envelopes.data ?? []).map((e) => ({ value: e.id, label: envelopeLabel(e, t) }))
      : (categories.data ?? []).filter((c) => c.kind === 'expense').map((c) => ({ value: c.id, label: categoryLabel(c, t) }));

  const loadFailed = categories.isError || envelopes.isError;
  const retryLoad = () => {
    void categories.refetch();
    void envelopes.refetch();
  };

  async function save() {
    const amount = parseMoney(amountText, base, locale);
    if (!amount.ok || !isPositive(amount.value)) {
      setFieldError({ amount: t('expenses.invalidAmount') });
      return;
    }
    if (targetId === null) {
      setFieldError({ target: t('expenses.chooseTarget') });
      return;
    }
    setFieldError({});
    setError(null);
    setSaving(true);
    const target: LimitTarget = targetKind === 'envelope' ? { envelopeId: targetId } : { categoryId: targetId };
    const result = await setLimit(target, amount.value);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    onDone();
    void refresh();
  }

  function confirmDelete() {
    if (initial === undefined) return;
    Alert.alert(t('expenses.deleteLimitTitle'), undefined, [
      { text: t('expenses.cancel'), style: 'cancel' },
      {
        text: t('expenses.deleteLimit'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void deleteLimit(initial.limitId).then((result) => {
            // a retry after a lost response finds it already gone: that is the outcome we wanted
            if (!result.ok && result.error !== 'unknown_limit') {
              setSaving(false);
              setError(result.error);
              return;
            }
            onDone();
            void refresh();
          });
        },
      },
    ]);
  }

  return (
    <Screen>
      {loadFailed && <LoadError onRetry={retryLoad} />}
      {initial === undefined ? (
        <>
          <SegmentedControl
            accessibilityLabel={t('expenses.limitTargetKind')}
            value={targetKind}
            onChange={(next) => {
              setTargetKind(next);
              setTargetId(null);
            }}
            options={[
              { value: 'envelope', label: t('expenses.envelope') },
              { value: 'category', label: t('expenses.category') },
            ]}
          />
          <ChipGroup accessibilityLabel={t('expenses.limitTarget')} value={targetId} onChange={setTargetId} chips={targets} />
          {fieldError.target !== undefined && (
            <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {fieldError.target}
            </Text>
          )}
        </>
      ) : (
        <Text variant="headline">{targets.find((c) => c.value === targetId)?.label ?? ''}</Text>
      )}
      <TextField
        label={t('expenses.limitAmount', { currency: base })}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0"
        error={fieldError.amount}
      />
      <Text variant="footnote" color="textSecondary">
        {t('expenses.limitHint')}
      </Text>
      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`expenses.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('expenses.saving') : t('expenses.save')} disabled={saving} onPress={() => void save()} />
      {initial !== undefined && (
        <Button label={t('expenses.deleteLimit')} variant="destructive" disabled={saving} onPress={confirmDelete} />
      )}
    </Screen>
  );
}
