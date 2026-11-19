// Parser for the National Bank of Kazakhstan daily rates feed
// (https://nationalbank.kz/rss/get_rates.cfm?fdate=DD.MM.YYYY). Pure TypeScript with no Deno or
// Node APIs, so Jest can test it (supabase/functions is outside the app's tsconfig).
//
// The feed is a flat RSS-like document: <date>DD.MM.YYYY</date> and one <item> per currency with
// <title> (ISO code), <description> (tenge for `quant` units, e.g. "443.96") and <quant>.

export type ReferenceRate = Readonly<{ currency: string; kztPerUnit: string }>;
export type ParsedRates = Readonly<{ rateDate: string; rates: readonly ReferenceRate[] }>;
export type ParseError = 'missing_date' | 'no_rates';
export type ParseResult = { ok: true; value: ParsedRates } | { ok: false; error: ParseError };

const DECIMAL = /^\d{1,9}(\.\d{1,8})?$/;
const QUANT = /^1(0{0,6})$/; // 1, 10, 100, … : division is then an exact decimal shift

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block);
  return match?.[1] ?? null;
}

/** "443.96" / 10 → "44.396", exactly (quant is a power of ten). */
function shiftLeft(decimal: string, places: number): string {
  if (places === 0) return decimal;
  const [whole = '0', fraction = ''] = decimal.split('.');
  const digits = (whole + fraction).padStart(whole.length + places, '0');
  const point = digits.length - fraction.length - places;
  const result = `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/^0+(?=\d)/, '').replace(/\.?0+$/, '');
  return result === '' ? '0' : result;
}

/**
 * Extracts the rates of the wanted currencies. Items that are not wanted, malformed, zero or have
 * an unusual quant are skipped rather than guessed, so a bad row never reaches the database.
 */
export function parseNbkRates(xml: string, wanted: ReadonlySet<string>): ParseResult {
  const date = /<date>\s*(\d{2})\.(\d{2})\.(\d{4})\s*<\/date>/.exec(xml);
  if (date === null) return { ok: false, error: 'missing_date' };
  const rateDate = `${date[3]}-${date[2]}-${date[1]}`;

  const rates: ReferenceRate[] = [];
  const seen = new Set<string>();
  for (const [block] of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const currency = tag(block, 'title');
    const value = tag(block, 'description');
    const quant = tag(block, 'quant');
    if (currency === null || value === null || quant === null) continue;
    if (!wanted.has(currency) || seen.has(currency)) continue;
    const quantMatch = QUANT.exec(quant);
    if (!DECIMAL.test(value) || quantMatch === null) continue;
    const kztPerUnit = shiftLeft(value, quantMatch[1]?.length ?? 0);
    if (!/[1-9]/.test(kztPerUnit)) continue;
    seen.add(currency);
    rates.push({ currency, kztPerUnit });
  }
  return rates.length === 0 ? { ok: false, error: 'no_rates' } : { ok: true, value: { rateDate, rates } };
}

/** The feed's date parameter for a calendar day in Kazakhstan. */
export function feedDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

/** A real calendar date in YYYY-MM-DD form (rejects shapes like 2026-13-45). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Whole days from `earlier` to `later` (both YYYY-MM-DD). */
export function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

/**
 * Guards against a garbage or spoofed feed: a new rate is accepted when there is no previous rate
 * or when it moved by at most MAX_MOVE either way. Floating point is fine here: this is a sanity
 * bound on a rate, not money arithmetic (CLAUDE.md rule 1 is about amounts).
 */
export const MAX_MOVE = 0.3;
export function isPlausibleMove(previous: string | null, next: string): boolean {
  if (previous === null) return true;
  const ratio = Number(next) / Number(previous);
  return Number.isFinite(ratio) && ratio >= 1 - MAX_MOVE && ratio <= 1 / (1 - MAX_MOVE);
}
