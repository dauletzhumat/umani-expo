import { getLocales } from 'expo-localization';

import { createI18n, pickLanguage, type Language } from './i18n';
import { installPluralRulesPolyfill } from './plural-rules';

// Hermes on iOS has no Intl.PluralRules; i18next needs it for plural forms (M1c spike).
installPluralRulesPolyfill();

/** The app's i18n instance. Language follows the device until the user picks one in Settings. */
export const i18n = createI18n(pickLanguage(getLocales()));

export function setLanguage(language: Language): Promise<unknown> {
  return i18n.changeLanguage(language);
}

export { LANGUAGES, isLanguage, type Language } from './i18n';
