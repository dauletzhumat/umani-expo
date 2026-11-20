import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { effectiveRate } from '@/domain/fx/effective-rate';
import { convert } from '@/domain/money/convert';
import { formatAmount } from '@/domain/money/format';
import { money, type Money } from '@/domain/money/money';
import { toWire } from '@/domain/money/wire';
import { parseMoney } from '@/domain/money/parse';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import { recordTransfer, useEnvelopeChoices, useFxRate, useRefreshAfterWrite } from '../api/accounts';
import { formatRate, rateFromInput, type Account, type AccountError } from '../model/account';
import { parseLocale } from './create-account-screen';
import { effectiveRateInput, RateField } from '@/ui/rate-field';
import { useIntentKey } from '@/lib/use-intent-key';

const ENVELOPE_KEYS = [
  'envelope.needs',
  'envelope.wants',
  'envelope.savings',
  'envelope.spending',
  'envelope.living',
  'envelope.debtGiving',
  'envelope.unallocated',
] as const;
type EnvelopeKey = (typeof ENVELOPE_KEYS)[number];
const isEnvelopeKey = (key: string | null): key is EnvelopeKey => (ENVELOPE_KEYS as readonly (string | null)[]).includes(key);

export type TransferScreenProps = Readonly<{
  userId: string | null;
  accounts: readonly Account[];
  initialFromId?: string;
  /** Preselected destination, e.g. a deposit to contribute to (DEP-4). */
  initialToId?: string;
  onDone: () => void;
}>;

/** Transfer between own accounts, incl. cross-currency with the derived rate (PRD ACC-6, ACC-8). */
export function TransferScreen({ userId, accounts, initialFromId, initialToId, onDone }: TransferScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = parseLocale(i18n.language);
  const refresh = useRefreshAfterWrite();
  const envelopes = useEnvelopeChoices(userId);

  // an archived or unknown initial account falls back to the first one
  const presetTo = accounts.find((a) => a.id === initialToId)?.id;
  const firstId =
    accounts.find((a) => a.id === initialFromId)?.id ?? accounts.find((a) => a.id !== presetTo)?.id ?? accounts[0]?.id ?? '';
  const [fromId, setFromId] = useState(firstId);
  const [toId, setToId] = useState(() => presetTo ?? accounts.find((a) => a.id !== firstId)?.id ?? '');
  const [sentText, setSentText] = useState('');
  const [receivedText, setReceivedText] = useState('');
  const [envelopeId, setEnvelopeId] = useState<string | null>(null);
  const [rateText, setRateText] = useState<string | null>(null);
  const [showRate, setShowRate] = useState(false);
  const [fieldError, setFieldError] = useState<{ sent?: string; received?: string; rate?: string }>({});
  const [error, setError] = useState<AccountError | null>(null);
  const [saving, setSaving] = useState(false);
  const intent = useIntentKey();

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const cross = from !== undefined && to !== undefined && from.currency !== to.currency;
  const pairRate = useFxRate(cross ? from.currency : undefined, cross ? to.currency : undefined);
  // the overdraft rate (rate_required) values the source currency in the budget base, via book value
  const baseOfBook = from?.bookValue.currency;
  const overdraftRate = useFxRate(showRate && from !== undefined ? from.currency : undefined, baseOfBook);

  const sent = from === undefined || sentText.trim() === '' ? null : parseMoney(sentText, from.currency, locale);
  const converted = cross && sent?.ok === true && pairRate.data ? convert(sent.value, pairRate.data.rate, to.currency) : null;
  const suggestedReceived: Money | null = converted?.ok === true ? converted.value : null;
  // ACC-6 / R2: the user enters what actually arrived; the reference conversion is only a hint
  const typedReceived = cross && to !== undefined && receivedText.trim() !== '' ? parseMoney(receivedText, to.currency, locale) : null;
  const received: Money | null = !cross
    ? sent?.ok === true && to !== undefined
      ? money(sent.value.amountMinor, to.currency)
      : null
    : typedReceived?.ok === true
      ? typedReceived.value
      : null;
  // 6 decimals for ordinary rates; small ones (1 KZT ≈ 0.002 USD) get 10 to keep significant digits
  const coarse = cross && sent?.ok === true && received !== null ? effectiveRate(sent.value, received) : null;
  const rate =
    coarse?.ok === true && coarse.value.startsWith('0') && sent?.ok === true && received !== null
      ? effectiveRate(sent.value, received, 10)
      : coarse;

  // R3: envelopes move only when money crosses the budget boundary
  const leavesBudget = from?.includeInBudget === true && to?.includeInBudget === false;
  const entersBudget = from?.includeInBudget === false && to?.includeInBudget === true;
  const unallocatedId = envelopes.data?.find((e) => e.kind === 'unallocated')?.id ?? null;
  const defaultEnvelope = leavesBudget ? (from?.linkedEnvelopeId ?? unallocatedId) : unallocatedId;
  const chosenEnvelope = envelopeId ?? defaultEnvelope;

  /** Inputs that belong to one pair of accounts: never carry them over to another pair. */
  function resetPairInputs() {
    setReceivedText('');
    setRateText(null);
    setShowRate(false);
    setEnvelopeId(null);
    setError(null);
    setFieldError({});
  }

  async function submit() {
    if (from === undefined || to === undefined) return;
    if (sent === null || !sent.ok) {
      setFieldError({ sent: t('accounts.invalidAmount') });
      return;
    }
    if (received === null) {
      setFieldError({ received: typedReceived === null ? t('accounts.receivedRequired') : t('accounts.invalidAmount') });
      return;
    }
    let overdraft: string | undefined;
    if (showRate) {
      const parsed = rateFromInput(effectiveRateInput(rateText, overdraftRate.data));
      if (parsed === null) {
        setFieldError({ rate: t('accounts.invalidRate') });
        return;
      }
      overdraft = parsed;
    }
    setFieldError({});
    setError(null);
    setSaving(true);
    const input = {
      fromId: from.id,
      toId: to.id,
      sent: sent.value,
      received,
      envelopeId: leavesBudget || entersBudget ? (chosenEnvelope ?? undefined) : undefined,
      rate: overdraft,
    };
    const signature = [input.fromId, input.toId, toWire(input.sent), toWire(input.received), input.envelopeId, input.rate].join('|');
    const result = await recordTransfer(input, intent.keyFor(signature));
    if (!result.ok) {
      setSaving(false);
      if (result.error === 'rate_required') setShowRate(true);
      setError(result.error);
      return;
    }
    intent.reset();
    await refresh();
    onDone();
  }

  if (accounts.length < 2) {
    return (
      <Screen>
        <Text variant="callout" color="textSecondary">
          {t('accounts.needTwoAccounts')}
        </Text>
      </Screen>
    );
  }

  const choices = (exclude: string) =>
    accounts.filter((a) => a.id !== exclude).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }));

  return (
    <Screen>
      <Text variant="footnote" color="textSecondary">
        {t('accounts.from')}
      </Text>
      <ChoiceList
        accessibilityLabel={t('accounts.from')}
        value={fromId}
        onChange={(id) => {
          setFromId(id);
          if (id === toId) setToId(accounts.find((a) => a.id !== id)?.id ?? '');
          resetPairInputs();
        }}
        choices={choices('')}
      />
      <Text variant="footnote" color="textSecondary">
        {t('accounts.to')}
      </Text>
      <ChoiceList
        accessibilityLabel={t('accounts.to')}
        value={toId}
        onChange={(id) => {
          setToId(id);
          resetPairInputs();
        }}
        choices={choices(fromId)}
      />
      {from !== undefined && (
        <TextField
          label={t('accounts.amount', { currency: from.currency })}
          value={sentText}
          onChangeText={setSentText}
          keyboardType="decimal-pad"
          placeholder="0"
          error={fieldError.sent}
        />
      )}
      {cross && to !== undefined && (
        <TextField
          label={t('accounts.received', { currency: to.currency })}
          value={receivedText}
          onChangeText={setReceivedText}
          keyboardType="decimal-pad"
          placeholder={suggestedReceived === null ? '0' : formatAmount(suggestedReceived, locale)}
          error={fieldError.received}
        />
      )}
      {cross && from !== undefined && to !== undefined && rate?.ok === true && (
        <Text variant="footnote" color="textSecondary">
          {t('accounts.effectiveRate', { from: from.currency, rate: formatRate(rate.value, locale), to: to.currency })}
        </Text>
      )}
      {(leavesBudget || entersBudget) && envelopes.data !== undefined && (
        <>
          <Text variant="footnote" color="textSecondary">
            {leavesBudget ? t('accounts.envelopeTake') : t('accounts.envelopeAdd')}
          </Text>
          <ChoiceList
            accessibilityLabel={leavesBudget ? t('accounts.envelopeTake') : t('accounts.envelopeAdd')}
            value={chosenEnvelope ?? ''}
            onChange={setEnvelopeId}
            choices={envelopes.data.map((e) => ({ value: e.id, label: isEnvelopeKey(e.nameKey) ? t(e.nameKey) : (e.name ?? '') }))}
          />
        </>
      )}
      {showRate && from !== undefined && baseOfBook !== undefined && (
        <RateField
          from={from.currency}
          to={baseOfBook}
          value={rateText}
          onChange={setRateText}
          suggestion={overdraftRate.data}
          error={fieldError.rate}
        />
      )}
      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`accounts.error_${error}`)}
        </Text>
      )}
      <Button
        label={saving ? t('accounts.saving') : t('accounts.transfer')}
        disabled={saving}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
