import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { PRESET_METHODS } from '@/domain/allocation/presets';
import type { PresetMethod } from '@/domain/allocation/envelope';
import { CURRENCY_CODES, type CurrencyCode } from '@/domain/money/currency';
import { money, type Money } from '@/domain/money/money';
import { parseMoney } from '@/domain/money/parse';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import { completeOnboarding } from '../api/complete-onboarding';

type Step = 'currency' | 'method' | 'account' | 'lock';

export type OnboardingScreenProps = Readonly<{
  /** Offered as the last step (PRD AUTH-5); resolves false if the user cancels Face ID. */
  enableLock: () => Promise<boolean>;
}>;

function parseLocale(language: string): 'ru' | 'kk' | 'en' {
  return language === 'kk' || language === 'en' ? language : 'ru';
}

/** First run: base currency → allocation method → first account → app lock offer. */
export function OnboardingScreen({ enableLock }: OnboardingScreenProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('currency');
  const [currency, setCurrency] = useState<CurrencyCode>('KZT');
  const [method, setMethod] = useState<PresetMethod>('50_30_20');
  const [name, setName] = useState(() => t('onboarding.accountNameDefault'));
  const [kind, setKind] = useState<'cash' | 'card'>('cash');
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [idempotencyKey] = useState(() => Crypto.randomUUID());

  const finish = () => queryClient.invalidateQueries({ queryKey: ['budget', 'active'] });

  async function submitAccount() {
    let opening: Money = money(0n, currency);
    if (amountText.trim() !== '') {
      const parsed = parseMoney(amountText, currency, parseLocale(i18n.language));
      if (!parsed.ok) {
        setAmountError(t('onboarding.invalidAmount'));
        return;
      }
      opening = parsed.value;
    }
    setAmountError(undefined);
    setSaving(true);
    setSaveFailed(false);
    const result = await completeOnboarding({
      method,
      firstAccount: { name: name.trim() || t('onboarding.accountNameDefault'), kind, opening },
      idempotencyKey,
    });
    setSaving(false);
    if (result.ok) setStep('lock');
    else setSaveFailed(true);
  }

  if (step === 'currency') {
    return (
      <Screen title={t('onboarding.currencyTitle')}>
        <Text variant="callout" color="textSecondary">
          {t('onboarding.currencyBody')}
        </Text>
        <SegmentedControl
          accessibilityLabel={t('onboarding.currencyTitle')}
          value={currency}
          onChange={setCurrency}
          options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
        />
        <Button label={t('onboarding.next')} onPress={() => setStep('method')} />
      </Screen>
    );
  }

  if (step === 'method') {
    return (
      <Screen title={t('onboarding.methodTitle')}>
        <Text variant="callout" color="textSecondary">
          {t('onboarding.methodBody')}
        </Text>
        <ChoiceList
          accessibilityLabel={t('onboarding.methodTitle')}
          value={method}
          onChange={setMethod}
          choices={PRESET_METHODS.map((m) => ({ value: m, label: t(`onboarding.method_${m}`) }))}
        />
        <View style={styles.row}>
          <Button label={t('onboarding.back')} variant="ghost" onPress={() => setStep('currency')} />
          <Button label={t('onboarding.next')} onPress={() => setStep('account')} />
        </View>
      </Screen>
    );
  }

  if (step === 'account') {
    return (
      <Screen title={t('onboarding.accountTitle')}>
        <Text variant="callout" color="textSecondary">
          {t('onboarding.accountBody')}
        </Text>
        <TextField label={t('onboarding.accountName')} value={name} onChangeText={setName} maxLength={60} />
        <SegmentedControl
          accessibilityLabel={t('onboarding.accountName')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'cash', label: '💵' },
            { value: 'card', label: '💳' },
          ]}
        />
        <TextField
          label={`${t('onboarding.openingBalance')}, ${currency}`}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
          error={amountError}
        />
        {saveFailed && (
          <Text variant="footnote" color="negative" accessibilityLiveRegion="polite">
            {t('onboarding.error')}
          </Text>
        )}
        <View style={styles.row}>
          <Button label={t('onboarding.back')} variant="ghost" disabled={saving} onPress={() => setStep('method')} />
          <Button
            label={saving ? t('onboarding.saving') : t('onboarding.next')}
            disabled={saving}
            onPress={() => void submitAccount()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('onboarding.lockTitle')}>
      <Text variant="callout" color="textSecondary">
        {t('onboarding.lockBody')}
      </Text>
      <View style={styles.column}>
        <Button
          label={t('onboarding.enableLock')}
          onPress={() => {
            void enableLock().then(() => finish());
          }}
        />
        <Button label={t('onboarding.skip')} variant="ghost" onPress={() => void finish()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  column: { gap: spacing.sm },
});
