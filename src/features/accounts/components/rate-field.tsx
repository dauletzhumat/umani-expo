import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import type { FxRate } from '../api/accounts';
import { formatDay } from '../model/account';

export type RateFieldProps = Readonly<{
  from: CurrencyCode;
  to: CurrencyCode;
  /** What the user typed; null until they touch the field, so the suggestion shows instead. */
  value: string | null;
  onChange: (value: string) => void;
  suggestion: FxRate | null | undefined;
  error?: string;
}>;

/** The rate the user confirms (DATABASE §5a R2), pre-filled from api.fx_rate with its source. */
export function RateField({ from, to, value, onChange, suggestion, error }: RateFieldProps) {
  const { t } = useTranslation();
  const hint =
    suggestion === null || suggestion === undefined
      ? t('accounts.rateNone')
      : suggestion.source === 'user'
        ? t('accounts.rateUser', { date: formatDay(suggestion.asOf) })
        : suggestion.source === 'nbk'
          ? t('accounts.rateNbk', { date: formatDay(suggestion.asOf) })
          : null; // identity: same currency, nothing to explain
  return (
    <View style={styles.field}>
      <TextField
        label={t('accounts.rate', { base: to, currency: from })}
        value={value ?? suggestion?.rate ?? ''}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        error={error}
      />
      {hint !== null && (
        <Text variant="footnote" color="textSecondary">
          {hint}
        </Text>
      )}
    </View>
  );
}

/** The rate to submit: what the user typed, else the suggestion they saw. */
export function effectiveRateInput(value: string | null, suggestion: FxRate | null | undefined): string {
  return value ?? suggestion?.rate ?? '';
}

const styles = StyleSheet.create({ field: { gap: spacing.xs } });
