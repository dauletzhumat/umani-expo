import { useTranslation } from 'react-i18next';

import { minorUnitsOf } from '../domain/money/currency';
import { formatAmount, formatMoney, type FormatLocale } from '../domain/money/format';
import type { Money } from '../domain/money/money';
import { Text } from './text';
import type { ColorTokens, TypographyVariant } from './tokens';

export type AmountMode = 'neutral' | 'signed' | 'income' | 'expense';

export type AmountTextProps = Readonly<{
  money: Money;
  variant?: TypographyVariant;
  /** neutral: as is; signed/income: "+" for positives; income/expense also colour the amount. */
  mode?: AmountMode;
  hideZeroFraction?: boolean;
}>;

function toFormatLocale(language: string): FormatLocale {
  return language === 'kk' || language === 'en' ? language : 'ru';
}

/**
 * The plural "count" for the spoken currency name. Only the last digits matter for ru/kk/en,
 * so large amounts are reduced without losing precision; fractions use the "other" form.
 */
function pluralCount(m: Money): number {
  const scale = 10n ** BigInt(minorUnitsOf(m.currency));
  const magnitude = m.amountMinor < 0n ? -m.amountMinor : m.amountMinor;
  const major = magnitude / scale;
  const hasFraction = magnitude % scale !== 0n;
  const reduced = major < 1000n ? Number(major) : Number(major % 1000n) + 1000;
  return hasFraction ? reduced + 0.5 : reduced;
}

function colorFor(m: Money, mode: AmountMode): keyof ColorTokens {
  if (mode === 'income') return 'positive';
  if (mode === 'expense') return 'negative';
  if (mode === 'signed' && m.amountMinor > 0n) return 'positive';
  return 'textPrimary';
}

/** A money amount: locale formatting, tabular figures, and a full spoken label for VoiceOver. */
export function AmountText({ money, variant = 'body', mode = 'neutral', hideZeroFraction = false }: AmountTextProps) {
  const { t, i18n } = useTranslation();
  const locale = toFormatLocale(i18n.language);
  const signDisplay = mode === 'signed' || mode === 'income' ? 'always' : 'auto';

  const spokenNumber = formatAmount(money, locale, { signDisplay: 'never', hideZeroFraction: true });
  const spokenCurrency = t(`currency.${money.currency}`, { count: pluralCount(money) });
  const spoken = `${money.amountMinor < 0n ? `${t('amount.minus')} ` : ''}${spokenNumber} ${spokenCurrency}`;

  return (
    <Text variant={variant} color={colorFor(money, mode)} tabular accessibilityLabel={spoken} maxFontSizeMultiplier={1.6}>
      {formatMoney(money, locale, { signDisplay, hideZeroFraction })}
    </Text>
  );
}
