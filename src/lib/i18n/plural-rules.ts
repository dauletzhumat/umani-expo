/**
 * Minimal Intl.PluralRules for the app's languages (ru, kk, en).
 *
 * Hermes on iOS (Expo Go, SDK 58) has no Intl.PluralRules, and i18next needs it to choose
 * plural forms ("1 тенге / 2 тенге / 5 тенге"). Cardinal rules follow CLDR; the tests compare
 * every result with Node's ICU implementation. Ordinal rules are not used by the app.
 */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

type Language = 'ru' | 'kk' | 'en';

const CATEGORIES: Readonly<Record<Language, readonly PluralCategory[]>> = {
  ru: ['one', 'few', 'many', 'other'],
  kk: ['one', 'other'],
  en: ['one', 'other'],
};

function languageOf(locale: string): Language | null {
  const language = locale.split(/[-_]/)[0]?.toLowerCase();
  return language === 'ru' || language === 'kk' || language === 'en' ? language : null;
}

/**
 * CLDR operands after the rounding Intl.PluralRules applies by default (at most 3 fraction
 * digits, half away from zero): i = integer digits, v = visible fraction digits. Computed on
 * the shortest decimal string, so no float arithmetic is involved.
 */
function operands(value: number): { i: bigint; v: number } {
  const abs = Math.abs(value);
  const text = String(abs);
  if (text.includes('e')) {
    // exponent notation only for < 1e-6 (rounds to 0) or ≥ 1e21 (an integer)
    return abs < 1 ? { i: 0n, v: 0 } : { i: BigInt(abs), v: 0 };
  }
  const [integerText = '0', fractionText = ''] = text.split('.');
  let scaled = BigInt(integerText + fractionText.slice(0, 3).padEnd(3, '0'));
  if (fractionText.charAt(3) >= '5') scaled += 1n;
  const digits = scaled.toString().padStart(4, '0');
  return {
    i: BigInt(digits.slice(0, -3)),
    v: digits.slice(-3).replace(/0+$/, '').length,
  };
}

function russian(i: bigint, v: number): PluralCategory {
  if (v !== 0) return 'other';
  const mod10 = i % 10n;
  const mod100 = i % 100n;
  if (mod10 === 1n && mod100 !== 11n) return 'one';
  if (mod10 >= 2n && mod10 <= 4n && (mod100 < 12n || mod100 > 14n)) return 'few';
  return 'many';
}

/** CLDR cardinal category for a number in the given locale (unknown languages use English rules). */
export function pluralCategory(locale: string, value: number): PluralCategory {
  if (!Number.isFinite(value)) return 'other';
  const { i, v } = operands(value);
  switch (languageOf(locale) ?? 'en') {
    case 'ru':
      return russian(i, v);
    case 'kk':
      return i === 1n && v === 0 ? 'one' : 'other';
    case 'en':
      return i === 1n && v === 0 ? 'one' : 'other';
  }
}

type PluralRulesOptions = Readonly<{ type?: 'cardinal' | 'ordinal' }>;

/** The subset of Intl.PluralRules that i18next uses. */
export class PluralRulesPolyfill {
  private readonly language: Language;
  private readonly type: 'cardinal' | 'ordinal';

  constructor(locales?: string | readonly string[], options: PluralRulesOptions = {}) {
    const requested = typeof locales === 'string' ? [locales] : [...(locales ?? [])];
    this.language = requested.map(languageOf).find((l): l is Language => l !== null) ?? 'en';
    this.type = options.type ?? 'cardinal';
  }

  select(value: number): PluralCategory {
    return this.type === 'ordinal' ? 'other' : pluralCategory(this.language, value);
  }

  resolvedOptions(): { locale: string; type: 'cardinal' | 'ordinal'; pluralCategories: PluralCategory[] } {
    return {
      locale: this.language,
      type: this.type,
      pluralCategories: this.type === 'ordinal' ? ['other'] : [...CATEGORIES[this.language]],
    };
  }

  static supportedLocalesOf(locales: string | readonly string[]): string[] {
    const list = typeof locales === 'string' ? [locales] : [...locales];
    return list.filter((locale) => languageOf(locale) !== null);
  }
}

/**
 * Installs the polyfill when the runtime lacks Intl.PluralRules. Returns true if installed.
 * `target` is injectable for tests; the app passes globalThis.
 */
export function installPluralRulesPolyfill(target: { Intl: object } = globalThis): boolean {
  const intl = target.Intl as { PluralRules?: unknown };
  if (typeof intl.PluralRules === 'function') return false;
  Object.defineProperty(intl, 'PluralRules', {
    value: PluralRulesPolyfill,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return true;
}
