/**
 * Supported currencies (PRD ACC-2). Minor units follow ISO 4217 and must match
 * the `public.currencies` seed in the database.
 */
export const CURRENCIES = {
  KZT: { minorUnits: 2 },
  USD: { minorUnits: 2 },
  EUR: { minorUnits: 2 },
  RUB: { minorUnits: 2 },
  CNY: { minorUnits: 2 },
} as const satisfies Record<string, { readonly minorUnits: number }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES: readonly CurrencyCode[] = Object.freeze(Object.keys(CURRENCIES) as CurrencyCode[]);

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function minorUnitsOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}
