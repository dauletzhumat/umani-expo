import { minorUnitsOf, symbolOf, type CurrencyCode } from './currency';
import type { Money } from './money';

/**
 * Locale-aware money formatting (DESIGN_SYSTEM.md §5), implemented without Intl: Hermes on
 * iOS prints "12 500,50 KZT" (ru) and "KZT 12,500.50" (en) for currencies, and the app needs
 * the same output in Jest (Node) and on device. Output always parses back with parseMoney.
 */

export type FormatLocale = 'ru' | 'kk' | 'en';

export type FormatOptions = Readonly<{
  /** Drop ",00" for whole amounts (lists). Non-zero fractions are always shown. */
  hideZeroFraction?: boolean;
  /** auto: "−" for negatives; always: also "+" for positives (income); never: magnitude only. */
  signDisplay?: 'auto' | 'always' | 'never';
}>;

const NARROW_NBSP = ' ';
const NBSP = ' ';
const MINUS = '−';

const SEPARATORS: Readonly<Record<FormatLocale, Readonly<{ group: string; decimal: string }>>> = {
  ru: { group: NARROW_NBSP, decimal: ',' },
  kk: { group: NARROW_NBSP, decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/** In English these symbols lead ("$12.50"); everything else trails ("12 500 ₸"). */
const PREFIX_IN_EN: ReadonlySet<CurrencyCode> = new Set<CurrencyCode>(['USD', 'EUR', 'CNY']);

function groupDigits(digits: string, separator: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits.charAt(i);
  }
  return out;
}

function signOf(amountMinor: bigint, display: FormatOptions['signDisplay']): string {
  if (display === 'never') return '';
  if (amountMinor < 0n) return MINUS;
  if (display === 'always' && amountMinor > 0n) return '+';
  return '';
}

function digitsOf(m: Money, locale: FormatLocale, hideZeroFraction: boolean): string {
  const minorUnits = minorUnitsOf(m.currency);
  const magnitude = (m.amountMinor < 0n ? -m.amountMinor : m.amountMinor).toString().padStart(minorUnits + 1, '0');
  const integerPart = magnitude.slice(0, magnitude.length - minorUnits);
  const fraction = magnitude.slice(magnitude.length - minorUnits);
  const { group, decimal } = SEPARATORS[locale];
  const grouped = groupDigits(integerPart, group);
  if (minorUnits === 0 || (hideZeroFraction && /^0+$/.test(fraction))) return grouped;
  return `${grouped}${decimal}${fraction}`;
}

/** The number only, e.g. "12 500,50" (ru) or "12,500.50" (en). */
export function formatAmount(m: Money, locale: FormatLocale, options: FormatOptions = {}): string {
  return signOf(m.amountMinor, options.signDisplay) + digitsOf(m, locale, options.hideZeroFraction ?? false);
}

/** The number with its currency symbol, e.g. "12 500,50 ₸" or "$12,500.50". */
export function formatMoney(m: Money, locale: FormatLocale, options: FormatOptions = {}): string {
  const sign = signOf(m.amountMinor, options.signDisplay);
  const body = digitsOf(m, locale, options.hideZeroFraction ?? false);
  const symbol = symbolOf(m.currency);
  if (locale === 'en' && PREFIX_IN_EN.has(m.currency)) return `${sign}${symbol}${body}`;
  return `${sign}${body}${NBSP}${symbol}`;
}
