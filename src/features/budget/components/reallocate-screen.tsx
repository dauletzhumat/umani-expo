import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/domain/money/currency';
import { parseMoney } from '@/domain/money/parse';
import { toWire } from '@/domain/money/wire';
import { useIntentKey } from '@/lib/use-intent-key';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { formatMoney } from '@/domain/money/format';

import { reallocate, useEnvelopes, useRefreshAfterBudgetWrite } from '../api/budget';
import type { BudgetError } from '../model/budget';
import { envelopeLabel, localeOf } from './labels';

export type ReallocateScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  initialFromId?: string;
  onDone: () => void;
}>;

/** Move budget between envelopes, e.g. assign Unallocated (BUD-6). Accounts don't change. */
export function ReallocateScreen({ userId, base, initialFromId, onDone }: ReallocateScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterBudgetWrite();
  const envelopes = useEnvelopes(userId, base);
  const intent = useIntentKey();
  const list = envelopes.data ?? [];

  const [fromId, setFromId] = useState<string | null>(initialFromId ?? null);
  const [toId, setToId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<BudgetError | null>(null);
  const [saving, setSaving] = useState(false);

  const from = fromId ?? list[0]?.id ?? null;
  const to = toId ?? list.find((e) => e.id !== from)?.id ?? null;
  const source = list.find((e) => e.id === from);

  async function save() {
    if (from === null || to === null) return;
    const amount = parseMoney(amountText, base, locale);
    if (!amount.ok) {
      setFieldError(t('budget.invalidAmount'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setSaving(true);
    const result = await reallocate(from, to, amount.value, intent.keyFor([from, to, toWire(amount.value)].join('|')));
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    intent.reset();
    await refresh();
    onDone();
  }

  const choices = (exclude: string | null) =>
    list
      .filter((e) => e.id !== exclude)
      .map((e) => ({ value: e.id, label: `${envelopeLabel(e, t)} · ${formatMoney(e.balance, locale)}` }));

  return (
    <Screen>
      <Text variant="footnote" color="textSecondary">
        {t('budget.from')}
      </Text>
      <ChoiceList
        accessibilityLabel={t('budget.from')}
        value={from ?? ''}
        onChange={(id) => {
          setFromId(id);
          if (id === to) setToId(null);
        }}
        choices={choices(null)}
      />
      <Text variant="footnote" color="textSecondary">
        {t('budget.to')}
      </Text>
      <ChoiceList accessibilityLabel={t('budget.to')} value={to ?? ''} onChange={setToId} choices={choices(from)} />
      <TextField
        label={t('budget.amount', { currency: base })}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder={source === undefined || source.balance.amountMinor <= 0n ? '0' : formatMoney(source.balance, locale)}
        error={fieldError}
      />
      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`budget.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('budget.saving') : t('budget.save')} disabled={saving} onPress={() => void save()} />
    </Screen>
  );
}
