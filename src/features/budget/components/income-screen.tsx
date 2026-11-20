import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { autoAllocateIncome, manualAllocateIncome } from '@/domain/allocation/income';
import { convert, parseRate } from '@/domain/money/convert';
import type { CurrencyCode } from '@/domain/money/currency';
import { formatAmount, formatMoney } from '@/domain/money/format';
import { money, type Money } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { fromWire, toWire } from '@/domain/money/wire';
import { ok } from '@/domain/shared/result';
import { useIntentKey } from '@/lib/use-intent-key';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { ListRow } from '@/ui/list-row';
import { effectiveRateInput, RateField } from '@/ui/rate-field';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import {
  amendIncome,
  recordIncome,
  reverseEntry,
  useEnvelopes,
  useIncomeCategories,
  useIncomeRate,
  useRefreshAfterBudgetWrite,
  type IncomeInput,
} from '../api/budget';
import {
  formatDay,
  todayIso,
  toBudgetEnvelopes,
  type AccountOption,
  type BudgetError,
  type Envelope,
  type IncomeEntry,
} from '../model/budget';
import { categoryLabel, envelopeLabel, localeOf } from './labels';

/** "475,5" → "475.5" if it is a valid positive rate. */
function rateFromInput(input: string): string | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  return parseRate(normalized).ok ? normalized : null;
}

export type IncomeScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  accounts: readonly AccountOption[];
  /** Set when editing (INC-5): the form starts from this income and saves through amend_entry. */
  initial?: IncomeEntry;
  /** The original envelope lines (base currency, Unallocated included) and confirmed rate. */
  initialParts?: readonly Readonly<{ envelopeId: string; amount: string }>[];
  initialRate?: string | null;
  onDone: () => void;
}>;

/**
 * Editing starts from the original split: manual when it differs from what the method would give
 * today (or left money in Unallocated), so saving never silently re-splits the income.
 */
function initialSplit(
  parts: IncomeScreenProps['initialParts'],
  envelopes: readonly Envelope[],
  base: CurrencyCode,
  locale: 'ru' | 'kk' | 'en',
): { mode: 'auto' | 'manual'; parts: Record<string, string> } {
  if (parts === undefined || parts.length === 0 || envelopes.length === 0) return { mode: 'auto', parts: {} };
  const amounts = parts.map((p) => ({ envelopeId: p.envelopeId, money: fromWire(p.amount, base) }));
  if (amounts.some((a) => !a.money.ok)) return { mode: 'auto', parts: {} };
  const lines = amounts.map((a) => ({ envelopeId: a.envelopeId, amount: a.money.ok ? a.money.value : money(0n, base) }));
  const total = lines.reduce((sum, l) => sum + l.amount.amountMinor, 0n);
  const auto = total > 0n ? autoAllocateIncome(money(total, base), toBudgetEnvelopes(envelopes)) : null;
  const sameAsAuto =
    auto?.ok === true &&
    auto.value.length === lines.length &&
    auto.value.every((l) => lines.some((o) => o.envelopeId === l.envelopeId && o.amount.amountMinor === l.amount.amountMinor));
  if (sameAsAuto) return { mode: 'auto', parts: {} };
  const unallocatedId = envelopes.find((e) => e.kind === 'unallocated')?.id;
  const manual: Record<string, string> = {};
  for (const line of lines) {
    if (line.envelopeId !== unallocatedId) manual[line.envelopeId] = formatAmount(line.amount, locale);
  }
  return { mode: 'manual', parts: manual };
}

/** Income entry (INC-1…5): account, amount, category, note; automatic or manual split. */
export function IncomeScreen({ userId, base, accounts, initial, initialParts, initialRate, onDone }: IncomeScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterBudgetWrite();
  const envelopes = useEnvelopes(userId, base);
  const categories = useIncomeCategories(userId);
  const intent = useIntentKey();

  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  const [amountText, setAmountText] = useState(initial === undefined ? '' : formatAmount(initial.amount, locale));
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  // editing a foreign income keeps the rate the user confirmed back then (never today's rate)
  const [rateText, setRateText] = useState<string | null>(initialRate ?? null);
  const [split, setSplit] = useState<{ mode: 'auto' | 'manual'; parts: Record<string, string> } | null>(null);
  const start = split ?? initialSplit(initialParts, envelopes.data ?? [], base, locale);
  const mode = start.mode;
  const parts = start.parts;
  const setMode = (next: 'auto' | 'manual') => setSplit({ mode: next, parts });
  const setParts = (next: Record<string, string>) => setSplit({ mode, parts: next });
  const [fieldError, setFieldError] = useState<{ amount?: string; rate?: string; parts?: string }>({});
  const [error, setError] = useState<BudgetError | null>(null);
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const foreign = account !== undefined && account.currency !== base;
  const suggestion = useIncomeRate(foreign ? account.currency : undefined, base);
  const assignable = (envelopes.data ?? []).filter((e) => e.kind !== 'unallocated');
  const budgetEnvelopes = toBudgetEnvelopes(envelopes.data ?? []);

  const amount = account === undefined || amountText.trim() === '' ? null : parseMoney(amountText, account.currency, locale);
  const rate = foreign ? rateFromInput(effectiveRateInput(rateText, suggestion.data)) : null;
  const converted = amount?.ok === true && foreign && rate !== null ? convert(amount.value, rate, base) : null;
  const baseAmount: Money | null =
    amount?.ok !== true ? null : !foreign ? amount.value : converted?.ok === true ? converted.value : null;

  // manual parts in the base currency; an empty field is zero
  const parsedParts = assignable.map((e) => {
    const text = parts[e.id] ?? '';
    return { envelopeId: e.id, parsed: text.trim() === '' ? ok(money(0n, base)) : parseMoney(text, base, locale) };
  });
  const manualValid = parsedParts.every((p) => p.parsed.ok);
  const manualMoney = parsedParts.map((p) => ({
    envelopeId: p.envelopeId,
    amount: p.parsed.ok ? p.parsed.value : money(0n, base),
  }));

  const preview =
    baseAmount === null || account?.includeInBudget !== true
      ? null
      : mode === 'auto'
        ? autoAllocateIncome(baseAmount, budgetEnvelopes)
        : manualAllocateIncome(
            baseAmount,
            budgetEnvelopes,
            manualMoney.filter((p) => p.amount.amountMinor > 0n),
          );
  const remainder =
    preview?.ok === true && mode === 'manual'
      ? preview.value.find((l) => envelopes.data?.find((e) => e.id === l.envelopeId)?.kind === 'unallocated')?.amount ??
        money(0n, base)
      : null;

  async function save() {
    if (account === undefined) return;
    if (amount === null || !amount.ok) {
      setFieldError({ amount: t('budget.invalidAmount') });
      return;
    }
    if (foreign && rate === null) {
      setFieldError({ rate: t('budget.invalidRate') });
      return;
    }
    const manual = mode === 'manual' && account.includeInBudget;
    if (manual && (!manualValid || preview?.ok !== true)) {
      setFieldError({ parts: preview?.ok === false && preview.error === 'exceeds_total' ? t('budget.error_exceeds_total') : t('budget.invalidAmount') });
      return;
    }
    setFieldError({});
    setError(null);
    setSaving(true);
    const input: IncomeInput = {
      accountId: account.id,
      amount: amount.value,
      occurredOn: initial?.occurredOn ?? todayIso(),
      categoryId,
      note,
      rate: foreign ? (rate ?? undefined) : undefined,
      manualParts: manual ? manualMoney.filter((p) => p.amount.amountMinor > 0n) : undefined,
    };
    const signature = [
      initial?.id,
      input.accountId,
      toWire(input.amount),
      input.occurredOn,
      input.categoryId,
      input.note.trim(),
      input.rate,
      input.manualParts?.map((p) => `${p.envelopeId}:${toWire(p.amount)}`).join(','),
    ].join('|');
    const key = intent.keyFor(signature);
    const result = initial === undefined ? await recordIncome(input, key) : await amendIncome(initial.id, input, key);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    intent.reset();
    // leave first: an edited income disappears from the edit query when the cache refreshes
    onDone();
    void refresh();
  }

  function confirmUndo() {
    if (initial === undefined) return;
    Alert.alert(t('budget.undoTitle'), t('budget.undoMessage'), [
      { text: t('budget.cancel'), style: 'cancel' },
      {
        text: t('budget.undo'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void reverseEntry(initial.id, intent.keyFor(`reverse|${initial.id}`)).then(async (result) => {
            if (!result.ok) {
              setSaving(false);
              setError(result.error);
              return;
            }
            intent.reset();
            onDone();
            void refresh();
          });
        },
      },
    ]);
  }

  if (accounts.length === 0) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary">
          {t('budget.noAccounts')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="footnote" color="textSecondary">
        {t('budget.account')}
      </Text>
      <ChoiceList
        accessibilityLabel={t('budget.account')}
        value={accountId}
        onChange={(id) => {
          setAccountId(id);
          setRateText(null);
          setSplit({ mode, parts: {} });
        }}
        choices={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
      />
      {account !== undefined && (
        <TextField
          label={t('budget.amount', { currency: account.currency })}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
          error={fieldError.amount}
        />
      )}
      {foreign && initialRate !== undefined && initialRate !== null && (
        <Text variant="footnote" color="textSecondary">
          {t('budget.editRateNote')}
        </Text>
      )}
      {foreign && account !== undefined && (
        <RateField
          from={account.currency}
          to={base}
          value={rateText}
          onChange={setRateText}
          suggestion={suggestion.data}
          error={fieldError.rate}
        />
      )}
      {foreign && baseAmount !== null && (
        <Text variant="footnote" color="textSecondary">
          {t('budget.baseHint', { amount: formatMoney(baseAmount, locale) })}
        </Text>
      )}

      {categories.data !== undefined && categories.data.length > 0 && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('budget.category')}
          </Text>
          <ChoiceList
            accessibilityLabel={t('budget.category')}
            value={categoryId ?? ''}
            onChange={setCategoryId}
            choices={categories.data.map((c) => ({ value: c.id, label: categoryLabel(c, t) }))}
          />
        </>
      )}
      <TextField label={t('budget.note')} value={note} onChangeText={setNote} maxLength={500} />
      {initial !== undefined && (
        <Text variant="footnote" color="textSecondary">
          {t('budget.dateNote', { date: formatDay(initial.occurredOn) })}
        </Text>
      )}

      {account?.includeInBudget === false ? (
        <Text variant="footnote" color="textSecondary">
          {t('budget.outsideBudgetHint')}
        </Text>
      ) : (
        <View style={styles.group}>
          <Text variant="body">{t('budget.allocation')}</Text>
          <SegmentedControl
            accessibilityLabel={t('budget.allocation')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'auto', label: t('budget.auto') },
              { value: 'manual', label: t('budget.manual') },
            ]}
          />
          {mode === 'auto' ? (
            preview?.ok === true && (
              <Surface padded={false}>
                <ListRow title={t('budget.autoHint')} />
                {preview.value.map((line) => {
                  const envelope = envelopes.data?.find((e) => e.id === line.envelopeId);
                  return (
                    <ListRow
                      key={line.envelopeId}
                      title={envelope === undefined ? '' : envelopeLabel(envelope, t)}
                      trailing={<AmountText money={line.amount} />}
                    />
                  );
                })}
              </Surface>
            )
          ) : (
            <>
              {assignable.map((envelope) => (
                <TextField
                  key={envelope.id}
                  label={`${envelopeLabel(envelope, t)}, ${base}`}
                  value={parts[envelope.id] ?? ''}
                  onChangeText={(text) => setParts({ ...parts, [envelope.id]: text })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              ))}
              {remainder !== null && (
                <Text variant="footnote" color="textSecondary">
                  {t('budget.manualHint', { amount: formatMoney(remainder, locale) })}
                </Text>
              )}
              {fieldError.parts !== undefined && (
                <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {fieldError.parts}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`budget.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('budget.saving') : t('budget.save')} disabled={saving} onPress={() => void save()} />
      {initial !== undefined && (
        <Button label={t('budget.undo')} variant="destructive" disabled={saving} onPress={confirmUndo} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
