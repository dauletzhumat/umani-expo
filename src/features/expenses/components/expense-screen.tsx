import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { formatAmount, formatMoney } from '@/domain/money/format';
import { isNegative, isPositive, negate } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { toWire } from '@/domain/money/wire';
import { useIntentKey } from '@/lib/use-intent-key';
import { Button } from '@/ui/button';
import { ChipGroup } from '@/ui/chip-group';
import { ListRow } from '@/ui/list-row';
import { effectiveRateInput, RateField } from '@/ui/rate-field';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import {
  amendExpense,
  recordExpense,
  reverseEntry,
  useCategories,
  useExpenseRate,
  useRefreshAfterExpenseWrite,
  useSpendEnvelopes,
  type ExpenseInput,
} from '../api/expenses';
import {
  accountForEdit,
  defaultEnvelopeFor,
  estimateBaseCost,
  formatDay,
  needsRate,
  projectedEnvelopeBalance,
  rateFromInput,
  todayIso,
  type ExpenseAccount,
  type ExpenseError,
  type HistoryItem,
} from '../model/expense';
import { LoadError } from './load-error';
import { categoryLabel, envelopeLabel, localeOf } from './labels';

export type ExpenseScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  accounts: readonly ExpenseAccount[];
  /** Set when editing (EXP-5): the form starts from this expense and saves through amend_entry. */
  initial?: HistoryItem;
  onManageCategories: () => void;
  onDone: () => void;
}>;

function yesterdayIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return todayIso(d);
}

/**
 * Expense entry (EXP-1): amount → category (its default envelope is preselected) → Save.
 * Overspending is allowed but shown before saving (EXP-3).
 */
export function ExpenseScreen({ userId, base, accounts, initial, onManageCategories, onDone }: ExpenseScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterExpenseWrite();
  const categories = useCategories(userId);
  const envelopes = useSpendEnvelopes(userId, base);
  const intent = useIntentKey();

  const firstAccount = accounts.find((a) => a.includeInBudget) ?? accounts[0];
  const [accountId, setAccountId] = useState(initial?.accountId ?? firstAccount?.id ?? '');
  const [amountText, setAmountText] = useState(
    initial === undefined ? '' : formatAmount(negate(initial.amount), locale),
  );
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  // null = follow the category's default envelope (or the original one when editing)
  const [pickedEnvelopeId, setPickedEnvelopeId] = useState<string | null>(null);
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [note, setNote] = useState(initial?.note ?? '');
  const [rateText, setRateText] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ amount?: string; envelope?: string; rate?: string }>({});
  const [error, setError] = useState<ExpenseError | null>(null);
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const expenseCategories = (categories.data ?? []).filter((c) => c.kind === 'expense');
  const category = expenseCategories.find((c) => c.id === categoryId);
  const spendEnvelopes = envelopes.data ?? [];
  // an edit keeps the original envelope until the user changes the category or the envelope
  const candidateEnvelopeId =
    pickedEnvelopeId ??
    (initial !== undefined && categoryId === initial.categoryId ? initial.envelopeId : null) ??
    defaultEnvelopeFor(category, spendEnvelopes);
  // an envelope archived since (method switch) can't take the expense: the user picks another
  const envelope = spendEnvelopes.find((e) => e.id === candidateEnvelopeId);
  const envelopeId = envelope?.id ?? null;

  const amount = account === undefined || amountText.trim() === '' ? null : parseMoney(amountText, account.currency, locale);
  const amountValue = amount?.ok === true ? amount.value : null;
  // editing: the server reverses the original first, so its amount is back on the account
  const position = account === undefined ? undefined : accountForEdit(account, initial);
  const foreignOverdraft = position !== undefined && needsRate(position.account, amountValue, base);
  const suggestion = useExpenseRate(foreignOverdraft && account !== undefined ? account.currency : undefined, base);
  const rate = foreignOverdraft ? rateFromInput(effectiveRateInput(rateText, suggestion.data)) : null;
  const cost =
    position !== undefined && position.bookKnown && amountValue !== null
      ? estimateBaseCost(position.account, amountValue, rate ?? undefined)
      : null;
  // ...and its envelope gets the original cost back (known for base-currency accounts)
  const refund =
    initial !== undefined && initial.envelopeId === envelopeId && initial.amount.currency === base
      ? negate(initial.amount)
      : null;
  const after =
    account?.includeInBudget === true && envelope !== undefined ? projectedEnvelopeBalance(envelope, cost, refund) : null;

  const loadFailed = categories.isError || envelopes.isError;
  const retryLoad = () => {
    void categories.refetch();
    void envelopes.refetch();
  };

  async function save() {
    if (account === undefined) return;
    if (amount === null || !amount.ok || !isPositive(amount.value)) {
      setFieldError({ amount: t('expenses.invalidAmount') });
      return;
    }
    if (account.includeInBudget && envelopeId === null) {
      setFieldError({ envelope: t('expenses.chooseEnvelope') });
      return;
    }
    if (foreignOverdraft && rate === null) {
      setFieldError({ rate: t('expenses.invalidRate') });
      return;
    }
    setFieldError({});
    setError(null);
    setSaving(true);
    const input: ExpenseInput = {
      accountId: account.id,
      amount: amount.value,
      occurredOn: initial?.occurredOn ?? (day === 'today' ? todayIso() : yesterdayIso()),
      envelopeId: account.includeInBudget ? envelopeId : null,
      categoryId,
      note,
      rate: foreignOverdraft ? (rate ?? undefined) : undefined,
    };
    const signature = [
      initial?.entryId,
      input.accountId,
      toWire(input.amount),
      input.occurredOn,
      input.envelopeId,
      input.categoryId,
      input.note.trim(),
      input.rate,
    ].join('|');
    const key = intent.keyFor(signature);
    const result = initial === undefined ? await recordExpense(input, key) : await amendExpense(initial.entryId, input, key);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    intent.reset();
    onDone();
    void refresh();
  }

  function confirmUndo() {
    if (initial === undefined) return;
    Alert.alert(t('expenses.undoTitle'), t('expenses.undoMessage'), [
      { text: t('expenses.cancel'), style: 'cancel' },
      {
        text: t('expenses.undo'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void reverseEntry(initial.entryId, intent.keyFor(`reverse|${initial.entryId}`)).then((result) => {
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
          {t('expenses.noAccounts')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      {loadFailed && <LoadError onRetry={retryLoad} />}
      {account !== undefined && (
        <TextField
          label={t('expenses.amount', { currency: account.currency })}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
          autoFocus={initial === undefined}
          error={fieldError.amount}
        />
      )}

      <Text variant="footnote" color="textSecondary">
        {t('expenses.category')}
      </Text>
      <ChipGroup
        accessibilityLabel={t('expenses.category')}
        value={categoryId}
        onChange={(id) => {
          setCategoryId(id);
          setPickedEnvelopeId(null);
        }}
        chips={expenseCategories.map((c) => ({ value: c.id, label: categoryLabel(c, t) }))}
      />

      {account?.includeInBudget !== false && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('expenses.envelope')}
          </Text>
          <ChipGroup
            accessibilityLabel={t('expenses.envelope')}
            value={envelopeId}
            onChange={setPickedEnvelopeId}
            chips={spendEnvelopes.map((e) => ({
              value: e.id,
              label: envelopeLabel(e, t),
              detail: formatMoney(e.balance, locale),
            }))}
          />
          {fieldError.envelope !== undefined && (
            <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {fieldError.envelope}
            </Text>
          )}
          {after !== null && isNegative(after) && envelope !== undefined && (
            <Text variant="footnote" color="negative" accessibilityLiveRegion="polite">
              {t('expenses.overspend', { envelope: envelopeLabel(envelope, t), amount: formatMoney(after, locale) })}
            </Text>
          )}
        </>
      )}

      {accounts.length > 1 && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('expenses.account')}
          </Text>
          <ChipGroup
            accessibilityLabel={t('expenses.account')}
            value={accountId}
            onChange={(id) => {
              setAccountId(id);
              setRateText(null);
            }}
            chips={accounts.map((a) => ({ value: a.id, label: a.name, detail: formatMoney(a.balance, locale) }))}
          />
        </>
      )}
      {account?.includeInBudget === false && (
        <Text variant="footnote" color="textSecondary">
          {t('expenses.outsideBudgetHint')}
        </Text>
      )}

      {foreignOverdraft && account !== undefined && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('expenses.overdraftRateHint')}
          </Text>
          <RateField
            from={account.currency}
            to={base}
            value={rateText}
            onChange={setRateText}
            suggestion={suggestion.data}
            error={fieldError.rate}
          />
        </>
      )}

      {initial === undefined ? (
        <SegmentedControl
          accessibilityLabel={t('expenses.date')}
          value={day}
          onChange={setDay}
          options={[
            { value: 'today', label: t('expenses.today') },
            { value: 'yesterday', label: t('expenses.yesterday') },
          ]}
        />
      ) : (
        <Text variant="footnote" color="textSecondary">
          {t('expenses.dateNote', { date: formatDay(initial.occurredOn) })}
        </Text>
      )}
      <TextField label={t('expenses.note')} value={note} onChangeText={setNote} maxLength={500} />

      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`expenses.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('expenses.saving') : t('expenses.save')} disabled={saving} onPress={() => void save()} />
      {initial !== undefined && (
        <Button label={t('expenses.undo')} variant="destructive" disabled={saving} onPress={confirmUndo} />
      )}
      <Surface padded={false}>
        <ListRow title={t('expenses.manageCategories')} onPress={onManageCategories} />
      </Surface>
    </Screen>
  );
}
