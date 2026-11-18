import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { PluralRulesPolyfill, installPluralRulesPolyfill, pluralCategory } from './plural-rules';

// Node ships full ICU, so its Intl.PluralRules is the reference the polyfill must match.
const NativePluralRules = Intl.PluralRules;

describe('pluralCategory matches CLDR (via Node Intl) for ru, kk, en', () => {
  it.each(['ru', 'kk', 'en'])('%s: integers 0..1000', (locale) => {
    const native = new NativePluralRules(locale);
    for (let n = 0; n <= 1000; n += 1) {
      expect([n, pluralCategory(locale, n)]).toEqual([n, native.select(n)]);
    }
  });

  it.each(['ru', 'kk', 'en'])('%s: random integers, negatives and decimals', (locale) => {
    const native = new NativePluralRules(locale);
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
          fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        ),
        (n) => {
          expect(pluralCategory(locale, n)).toBe(native.select(n));
        },
      ),
    );
  });

  it('known Russian forms: 1 тенге / 2 тенге / 5 тенге / 21 тенге / 1.5', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111, 1.5].map((n) => pluralCategory('ru-RU', n))).toEqual([
      'one', 'few', 'many', 'many', 'one', 'few', 'many', 'many', 'other',
    ]);
  });

  it('falls back to English rules for unknown languages and to other for non-finite numbers', () => {
    expect(pluralCategory('de', 1)).toBe('one');
    expect(pluralCategory('ru', Number.NaN)).toBe('other');
    expect(pluralCategory('ru', Number.POSITIVE_INFINITY)).toBe('other');
  });
});

describe('PluralRulesPolyfill (the subset i18next uses)', () => {
  it('select() and resolvedOptions()', () => {
    const rules = new PluralRulesPolyfill('ru-KZ');
    expect(rules.select(3)).toBe('few');
    expect(rules.resolvedOptions().locale).toBe('ru');
    expect([...rules.resolvedOptions().pluralCategories].sort()).toEqual(
      [...new NativePluralRules('ru').resolvedOptions().pluralCategories].sort(),
    );
    expect(new PluralRulesPolyfill(['kk-KZ', 'en']).resolvedOptions().pluralCategories).toEqual(['one', 'other']);
  });

  it('ordinal rules are not used by the app and always return other', () => {
    expect(new PluralRulesPolyfill('en', { type: 'ordinal' }).select(2)).toBe('other');
  });

  it('supportedLocalesOf keeps only ru, kk, en', () => {
    expect(PluralRulesPolyfill.supportedLocalesOf(['kk-KZ', 'de', 'en-US'])).toEqual(['kk-KZ', 'en-US']);
    expect(PluralRulesPolyfill.supportedLocalesOf('ru')).toEqual(['ru']);
  });
});

describe('installPluralRulesPolyfill', () => {
  it('installs only when Intl.PluralRules is missing (Hermes on iOS)', () => {
    const hermesLike: { Intl: Record<string, unknown> } = { Intl: {} };
    expect(installPluralRulesPolyfill(hermesLike)).toBe(true);
    expect(hermesLike.Intl.PluralRules).toBe(PluralRulesPolyfill);

    const nodeLike = { Intl: { PluralRules: NativePluralRules } };
    expect(installPluralRulesPolyfill(nodeLike)).toBe(false);
    expect(nodeLike.Intl.PluralRules).toBe(NativePluralRules);
  });
});
