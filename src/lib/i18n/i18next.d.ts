import 'i18next';

import type ru from '../../i18n/ru.json';

// Typed translation keys: t('tabs.home') is checked against ru.json (the source language).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof ru };
  }
}
