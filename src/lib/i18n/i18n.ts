import { createInstance, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../../i18n/en.json';
import kk from '../../i18n/kk.json';
import ru from '../../i18n/ru.json';
import type { PluralCategory } from './plural-rules';

/** App languages (PRD UX-3). */
export const LANGUAGES = ['ru', 'kk', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Plural forms each language needs (CLDR cardinal). Checked by the resource tests. */
export const REQUIRED_PLURALS: Readonly<Record<Language, readonly PluralCategory[]>> = {
  ru: ['one', 'few', 'many', 'other'],
  kk: ['one', 'other'],
  en: ['one', 'other'],
};

export const resources = {
  ru: { translation: ru },
  kk: { translation: kk },
  en: { translation: en },
} as const;

/** Regions where Russian is the expected default when no supported language is listed (PRD UX-3). */
const RUSSIAN_DEFAULT_REGIONS: ReadonlySet<string> = new Set(['KZ', 'RU', 'BY', 'KG']);

export type DeviceLocale = Readonly<{ languageCode: string | null; regionCode: string | null }>;

export function isLanguage(value: string | null | undefined): value is Language {
  return value === 'ru' || value === 'kk' || value === 'en';
}

/**
 * The first device language the app supports; otherwise Russian in KZ/RU/BY/KG regions,
 * otherwise English.
 */
export function pickLanguage(locales: readonly DeviceLocale[]): Language {
  for (const locale of locales) {
    const code = locale.languageCode?.toLowerCase();
    if (isLanguage(code)) return code;
  }
  return locales.some((l) => l.regionCode !== null && RUSSIAN_DEFAULT_REGIONS.has(l.regionCode.toUpperCase()))
    ? 'ru'
    : 'en';
}

/** A ready, synchronous i18next instance (resources are bundled). */
export function createI18n(language: Language): I18nInstance {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    interpolation: { escapeValue: false }, // React escapes output
    returnNull: false,
    initAsync: false,
  });
  return instance;
}
