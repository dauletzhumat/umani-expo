import { describe, expect, it } from '@jest/globals';

import en from '../../i18n/en.json';
import kk from '../../i18n/kk.json';
import ru from '../../i18n/ru.json';
import { LANGUAGES, REQUIRED_PLURALS, createI18n, pickLanguage, type Language } from './i18n';

const RESOURCES: Readonly<Record<Language, unknown>> = { ru, kk, en };
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { [prefix]: value };
  return Object.entries(value).reduce<Record<string, unknown>>(
    (acc, [key, child]) => ({ ...acc, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

function baseKeys(resource: unknown): string[] {
  return [...new Set(Object.keys(flatten(resource)).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort();
}

describe('translation resources', () => {
  it('every language has the same keys (plural suffixes aside)', () => {
    expect(baseKeys(kk)).toEqual(baseKeys(ru));
    expect(baseKeys(en)).toEqual(baseKeys(ru));
  });

  it.each(LANGUAGES)('%s: every plural key has exactly the forms the language needs', (language) => {
    const keys = Object.keys(flatten(RESOURCES[language]));
    const pluralBases = new Set(keys.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')));
    for (const base of pluralBases) {
      const forms = keys
        .filter((k) => k.replace(PLURAL_SUFFIX, '') === base && PLURAL_SUFFIX.test(k))
        .map((k) => k.slice(base.length + 1))
        .sort();
      expect([base, forms]).toEqual([base, [...REQUIRED_PLURALS[language]].sort()]);
    }
  });

  it.each(LANGUAGES)('%s: no empty strings', (language) => {
    for (const [key, value] of Object.entries(flatten(RESOURCES[language]))) {
      expect([key, typeof value === 'string' && value.trim().length > 0]).toEqual([key, true]);
    }
  });
});

describe('pickLanguage (device locales → app language)', () => {
  it.each([
    [[{ languageCode: 'en', regionCode: 'KZ' }, { languageCode: 'kk', regionCode: 'KZ' }], 'en'],
    [[{ languageCode: 'de', regionCode: 'DE' }, { languageCode: 'kk', regionCode: 'KZ' }], 'kk'],
    [[{ languageCode: 'ru', regionCode: null }], 'ru'],
    [[{ languageCode: 'de', regionCode: 'KZ' }], 'ru'],
    [[{ languageCode: 'uz', regionCode: 'RU' }], 'ru'],
    [[{ languageCode: 'de', regionCode: 'DE' }], 'en'],
    [[{ languageCode: null, regionCode: null }], 'en'],
    [[], 'en'],
  ] as const)('%j → %s', (locales, expected) => {
    expect(pickLanguage(locales)).toBe(expected);
  });
});

describe('i18n instance', () => {
  it('Russian plural forms', () => {
    const i18n = createI18n('ru');
    expect([1, 2, 5, 11, 21, 22].map((count) => i18n.t('currency.USD', { count }))).toEqual([
      'доллар', 'доллара', 'долларов', 'долларов', 'доллар', 'доллара',
    ]);
  });

  it('Kazakh and English plural forms', () => {
    expect(createI18n('kk').t('currency.KZT', { count: 5 })).toBe('теңге');
    const english = createI18n('en');
    expect(english.t('currency.USD', { count: 1 })).toBe('dollar');
    expect(english.t('currency.USD', { count: 2 })).toBe('dollars');
  });

  it('switches language at runtime', async () => {
    const i18n = createI18n('ru');
    expect(i18n.t('tabs.home')).toBe('Главная');
    await i18n.changeLanguage('kk');
    expect(i18n.t('tabs.home')).toBe('Басты бет');
    await i18n.changeLanguage('en');
    expect(i18n.t('tabs.home')).toBe('Home');
  });
});
