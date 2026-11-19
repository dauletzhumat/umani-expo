import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { bookPosition, revalue } from '@/domain/fx/book-value';
import type { CurrencyCode } from '@/domain/money/currency';
import { formatMoney } from '@/domain/money/format';
import { parseMoney } from '@/domain/money/parse';
import { toWire } from '@/domain/money/wire';
import { AmountText } from '@/ui/amount-text';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import { archiveAccount, reconcileAccount, revalueAccount, useFxRate, useRefreshAfterWrite } from '../api/accounts';
import { rateFromInput, type Account, type AccountError } from '../model/account';
import { parseLocale } from './create-account-screen';
import { effectiveRateInput, RateField } from './rate-field';
import { useIntentKey } from './use-intent-key';

export type AccountDetailScreenProps = Readonly<{
  account: Account;
  base: CurrencyCode;
  onTransfer: () => void;
  onArchived: () => void;
}>;

type Panel = 'none' | 'reconcile' | 'revalue';

/** One account: balance, book value, reconciliation, revaluation and archive (PRD ACC-4, ACC-7). */
export function AccountDetailScreen({ account, base, onTransfer, onArchived }: AccountDetailScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = parseLocale(i18n.language);
  const refresh = useRefreshAfterWrite();
  const foreign = account.currency !== base;
  const suggestion = useFxRate(foreign ? account.currency : undefined, base);

  const [panel, setPanel] = useState<Panel>('none');
  const [targetText, setTargetText] = useState('');
  const [rateText, setRateText] = useState<string | null>(null);
  const [showRate, setShowRate] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<AccountError | null>(null);
  const [saving, setSaving] = useState(false);
  const intent = useIntentKey();

  function open(next: Panel) {
    setPanel(panel === next ? 'none' : next);
    setRateText(null);
    setShowRate(false);
    setFieldError(undefined);
    setError(null);
  }

  async function finish(result: { ok: boolean; error?: AccountError }) {
    if (!result.ok) {
      setSaving(false);
      if (result.error === 'rate_required') setShowRate(true);
      setError(result.error ?? 'failed');
      return;
    }
    intent.reset(); // the next action is a new intent, even with the same inputs
    setError(null);
    setShowRate(false);
    setPanel('none');
    setTargetText('');
    await refresh();
    setSaving(false);
  }

  // R2: money entering a foreign account is valued at a rate the user confirms, so a reconciliation
  // that raises the balance needs one; ask up front instead of waiting for rate_required.
  const parsedTarget = targetText.trim() === '' ? null : parseMoney(targetText, account.currency, locale);
  const raisesForeign =
    foreign && parsedTarget?.ok === true && parsedTarget.value.amountMinor > account.balance.amountMinor;
  const reconcileNeedsRate = raisesForeign || showRate;

  async function submitReconcile() {
    const target = parseMoney(targetText, account.currency, locale);
    if (!target.ok) {
      setFieldError(t('accounts.invalidAmount'));
      return;
    }
    let rate: string | undefined;
    if (reconcileNeedsRate) {
      const parsed = rateFromInput(effectiveRateInput(rateText, suggestion.data));
      if (parsed === null) {
        setFieldError(t('accounts.invalidRate'));
        return;
      }
      rate = parsed;
    }
    setFieldError(undefined);
    setSaving(true);
    const key = intent.keyFor(['reconcile', toWire(target.value), rate].join('|'));
    const result = await reconcileAccount(account.id, target.value, key, rate);
    await finish(result.ok ? { ok: true } : { ok: false, error: result.error });
  }

  const revalueRate = rateFromInput(effectiveRateInput(rateText, suggestion.data));
  const preview = foreign && revalueRate !== null ? revalue(bookPosition(account.balance, account.bookValue), revalueRate) : null;

  async function submitRevalue() {
    if (revalueRate === null) {
      setFieldError(t('accounts.invalidRate'));
      return;
    }
    setFieldError(undefined);
    setSaving(true);
    const result = await revalueAccount(account.id, revalueRate, intent.keyFor(['revalue', revalueRate].join('|')));
    await finish(result.ok ? { ok: true } : { ok: false, error: result.error });
  }

  function confirmArchive() {
    Alert.alert(t('accounts.archiveTitle'), t('accounts.archiveMessage'), [
      { text: t('accounts.cancel'), style: 'cancel' },
      {
        text: t('accounts.archive'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void archiveAccount(account.id).then(async (result) => {
            if (!result.ok) {
              setSaving(false);
              setError(result.error);
              return;
            }
            await refresh();
            onArchived();
          });
        },
      },
    ]);
  }

  return (
    <Screen>
      <Surface style={styles.group}>
        <Text variant="subhead" color="textSecondary">
          {t('accounts.balance')}
        </Text>
        <AmountText money={account.balance} variant="display" />
        <Text variant="footnote" color="textSecondary">
          {account.includeInBudget
            ? t(`accounts.kind_${account.kind}`)
            : `${t(`accounts.kind_${account.kind}`)} · ${t('accounts.outsideBudget')}`}
        </Text>
        {foreign && (
          <View style={styles.bookValue}>
            <Text variant="subhead" color="textSecondary">
              {t('accounts.bookValue')}
            </Text>
            <AmountText money={account.bookValue} />
            <Text variant="footnote" color="textSecondary">
              {t('accounts.bookValueHint')}
            </Text>
          </View>
        )}
      </Surface>

      {!account.archived && (
        <View style={styles.group}>
          <Button label={t('accounts.transfer')} variant="secondary" onPress={onTransfer} />
          <Button label={t('accounts.reconcile')} variant="secondary" onPress={() => open('reconcile')} />
          {panel === 'reconcile' && (
            <Surface style={styles.group}>
              <Text variant="footnote" color="textSecondary">
                {t('accounts.reconcileHint')}
              </Text>
              <TextField
                label={t('accounts.actualBalance', { currency: account.currency })}
                value={targetText}
                onChangeText={setTargetText}
                keyboardType="decimal-pad"
                error={reconcileNeedsRate ? undefined : fieldError}
              />
              {reconcileNeedsRate && (
                <RateField
                  from={account.currency}
                  to={base}
                  value={rateText}
                  onChange={setRateText}
                  suggestion={suggestion.data}
                  error={fieldError}
                />
              )}
              <Button label={t('accounts.save')} disabled={saving} onPress={() => void submitReconcile()} />
            </Surface>
          )}
          {foreign && <Button label={t('accounts.revalue')} variant="secondary" onPress={() => open('revalue')} />}
          {panel === 'revalue' && (
            <Surface style={styles.group}>
              <RateField
                from={account.currency}
                to={base}
                value={rateText}
                onChange={setRateText}
                suggestion={suggestion.data}
                error={fieldError}
              />
              {preview?.ok === true && (
                <Text variant="footnote" color="textSecondary">
                  {t('accounts.revalueHint', {
                    target: formatMoney(preview.value.target, locale),
                    delta: formatMoney(preview.value.delta, locale),
                  })}
                </Text>
              )}
              <Button label={t('accounts.save')} disabled={saving} onPress={() => void submitRevalue()} />
            </Surface>
          )}
          {error !== null && (
            <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error === 'rate_required' && panel === 'reconcile'
                ? t('accounts.reconcileRateRequired')
                : t(`accounts.error_${error}`)}
            </Text>
          )}
          <Button label={t('accounts.archive')} variant="destructive" disabled={saving} onPress={confirmArchive} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  bookValue: { gap: spacing.xxs, marginTop: spacing.sm },
});
