/**
 * Supported currencies (PRD ACC-2). Minor units (ISO 4217) and symbols must match
 * the `public.currencies` seed in the database.
 */
export const CURRENCIES = {
  KZT: { minorUnits: 2, symbol: '₸' },
  USD: { minorUnits: 2, symbol: '$' },
  EUR: { minorUnits: 2, symbol: '€' },
  RUB: { minorUnits: 2, symbol: '₽' },
  CNY: { minorUnits: 2, symbol: '¥' },
} as const satisfies Record<string, { readonly minorUnits: number; readonly symbol: string }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES: readonly CurrencyCode[] = Object.freeze(Object.keys(CURRENCIES) as CurrencyCode[]);

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function minorUnitsOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}

export function symbolOf(currency: CurrencyCode): string {
  return CURRENCIES[currency].symbol;
}
