import { convert } from '../money/convert';
import type { CurrencyCode } from '../money/currency';
import { add, money, type Money } from '../money/money';

export type ApproximateTotal = Readonly<{
  total: Money;
  /** True when any balance was converted at a reference or last-used rate ("≈" in the UI). */
  approximate: boolean;
  /** Currencies left out because no rate is known (shown separately in the UI). */
  unconverted: readonly CurrencyCode[];
}>;

/**
 * Total of account balances in the base currency for Home (PRD ACC-4, DATABASE §5a R4). This is a
 * display figure, not a book value: foreign balances are converted at `rates` (base units per one
 * unit of the currency); balances without a rate are left out and listed.
 */
export function approximateTotal(
  balances: readonly Money[],
  base: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, string>,
): ApproximateTotal {
  let total = money(0n, base);
  let approximate = false;
  const unconverted: CurrencyCode[] = [];
  for (const balance of balances) {
    if (balance.currency === base) {
      total = add(total, balance);
      continue;
    }
    approximate = true;
    const rate = rates.get(balance.currency);
    const converted = rate === undefined ? null : convert(balance, rate, base);
    if (converted?.ok === true) {
      const next = total.amountMinor + converted.value.amountMinor;
      if (next <= 10n ** 15n && next >= -(10n ** 15n)) {
        total = add(total, converted.value);
        continue;
      }
    }
    if (!unconverted.includes(balance.currency)) unconverted.push(balance.currency);
  }
  return Object.freeze({ total, approximate, unconverted: Object.freeze(unconverted) });
}
