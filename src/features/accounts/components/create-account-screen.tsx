import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CURRENCY_CODES, type CurrencyCode } from '@/domain/money/currency';
import { money, type Money } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { toWire } from '@/domain/money/wire';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import { createAccount, useFxRate, useRefreshAfterWrite } from '../api/accounts';
import { ACCOUNT_KINDS, rateFromInput, type AccountError, type AccountKind } from '../model/account';
import { effectiveRateInput, RateField } from '@/ui/rate-field';
import { useIntentKey } from '@/lib/use-intent-key';

export type CreateAccountScreenProps = Readonly<{
  base: CurrencyCode;
  /**
   * Prefill from the deposit planner (DEP-3): a deposit linked to a savings envelope. A linked
   * account is always budgeted and starts empty — money moves in by transfer (DEP-4), so it stays
   * in the envelope instead of landing in Unallocated as an opening balance would.
   */
  initial?: Readonly<{ name?: string; kind?: AccountKind; linkedEnvelopeId?: string }>;
  onDone: () => void;
}>;

export function parseLocale(language: string): 'ru' | 'kk' | 'en' {
  return language === 'kk' || language === 'en' ? language : 'ru';
}

/** New account (PRD ACC-1…3, ACC-8): kind, currency, opening balance at a confirmed rate, budget flag. */
export function CreateAccountScreen({ base, initial, onDone }: CreateAccountScreenProps) {
  const { t, i18n } = useTranslation();
  const refresh = useRefreshAfterWrite();
  const linkedEnvelopeId = initial?.linkedEnvelopeId;
  const linked = linkedEnvelopeId !== undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(linked ? 'deposit' : (initial?.kind ?? 'card'));
  const [currency, setCurrency] = useState<CurrencyCode>(base);
  const [amountText, setAmountText] = useState('');
  const [rateText, setRateText] = useState<string | null>(null);
  const [inBudget, setInBudget] = useState(true);
  const [fieldError, setFieldError] = useState<{ amount?: string; rate?: string }>({});
  const [saveError, setSaveError] = useState<AccountError | null>(null);
  const [saving, setSaving] = useState(false);
  const intent = useIntentKey();
  const suggestion = useFxRate(currency, base);

  const foreign = currency !== base;
  const needsRate = !linked && foreign && amountText.trim() !== '' && !/^[0\s.,]*$/.test(amountText);

  async function save() {
    let opening: Money = money(0n, currency);
    if (!linked && amountText.trim() !== '') {
      const parsed = parseMoney(amountText, currency, parseLocale(i18n.language));
      if (!parsed.ok) {
        setFieldError({ amount: t('accounts.invalidAmount') });
        return;
      }
      opening = parsed.value;
    }
    let rate: string | undefined;
    if (needsRate) {
      const parsedRate = rateFromInput(effectiveRateInput(rateText, suggestion.data));
      if (parsedRate === null) {
        setFieldError({ rate: t('accounts.invalidRate') });
        return;
      }
      rate = parsedRate;
    }
    setFieldError({});
    setSaving(true);
    setSaveError(null);
    const input = {
      name: name.trim() || t(`accounts.kind_${kind}`),
      kind,
      opening,
      openingRate: rate,
      includeInBudget: linked || inBudget,
      linkedEnvelopeId,
    };
    const signature = [input.name, input.kind, toWire(input.opening), input.opening.currency, input.openingRate, input.includeInBudget, input.linkedEnvelopeId].join('|');
    const result = await createAccount(input, intent.keyFor(signature));
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }
    await refresh();
    onDone();
  }

  return (
    <Screen>
      <TextField
        label={t('accounts.name')}
        value={name}
        onChangeText={setName}
        placeholder={t(`accounts.kind_${kind}`)}
        maxLength={60}
      />
      {!linked && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('accounts.kind')}
          </Text>
          <ChoiceList
            accessibilityLabel={t('accounts.kind')}
            value={kind}
            onChange={setKind}
            choices={ACCOUNT_KINDS.map((k) => ({ value: k, label: t(`accounts.kind_${k}`) }))}
          />
        </>
      )}
      <Text variant="footnote" color="textSecondary">
        {t('accounts.currency')}
      </Text>
      <SegmentedControl
        accessibilityLabel={t('accounts.currency')}
        value={currency}
        onChange={(next) => {
          setCurrency(next);
          setRateText(null);
        }}
        options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
      />
      {linked ? (
        <Text variant="footnote" color="textSecondary">
          {t('accounts.linkedDepositHint')}
        </Text>
      ) : (
        <TextField
          label={`${t('accounts.opening')}, ${currency}`}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
          error={fieldError.amount}
        />
      )}
      {needsRate && (
        <RateField
          from={currency}
          to={base}
          value={rateText}
          onChange={setRateText}
          suggestion={suggestion.data}
          error={fieldError.rate}
        />
      )}
      {!linked && (
        <View style={styles.group}>
          <Text variant="body">{t('accounts.inBudget')}</Text>
          <SegmentedControl
            accessibilityLabel={t('accounts.inBudget')}
            value={inBudget ? 'yes' : 'no'}
            onChange={(value) => setInBudget(value === 'yes')}
            options={[
              { value: 'yes', label: t('accounts.yes') },
              { value: 'no', label: t('accounts.no') },
            ]}
          />
          <Text variant="footnote" color="textSecondary">
            {t('accounts.inBudgetHint')}
          </Text>
        </View>
      )}
      {saveError !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`accounts.error_${saveError}`)}
        </Text>
      )}
      <Button
        label={saving ? t('accounts.saving') : t('accounts.save')}
        disabled={saving}
        onPress={() => void save()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
