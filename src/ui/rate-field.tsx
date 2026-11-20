import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { CurrencyCode } from '../domain/money/currency';
import { Text } from './text';
import { TextField } from './text-field';
import { spacing } from './tokens';

/** A pre-fill rate and where it came from (api.fx_rate). */
export type RateSuggestion = Readonly<{ rate: string; source: 'user' | 'nbk' | 'identity'; asOf: string }>;

/** "2026-11-19" → "19.11.2026" (how dates read in Kazakhstan; avoids Hermes Intl gaps for kk). */
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year === undefined || month === undefined || day === undefined ? isoDate : `${day}.${month}.${year}`;
}

export type RateFieldProps = Readonly<{
  from: CurrencyCode;
  to: CurrencyCode;
  /** What the user typed; null until they touch the field, so the suggestion shows instead. */
  value: string | null;
  onChange: (value: string) => void;
  suggestion: RateSuggestion | null | undefined;
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
export function effectiveRateInput(value: string | null, suggestion: RateSuggestion | null | undefined): string {
  return value ?? suggestion?.rate ?? '';
}

const styles = StyleSheet.create({ field: { gap: spacing.xs } });
