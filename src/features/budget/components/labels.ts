import type { TFunction } from 'i18next';

import { isEnvelopeNameKey, isIncomeCategoryKey, type Category, type Envelope } from '../model/budget';

/** Preset envelopes and default categories are i18n keys; custom ones carry their own name. */
export function envelopeLabel(envelope: Pick<Envelope, 'name' | 'nameKey'>, t: TFunction): string {
  return isEnvelopeNameKey(envelope.nameKey) ? t(envelope.nameKey) : (envelope.name ?? '');
}

export function categoryLabel(category: Category, t: TFunction): string {
  return isIncomeCategoryKey(category.nameKey) ? t(category.nameKey) : (category.name ?? '');
}

export function localeOf(language: string): 'ru' | 'kk' | 'en' {
  return language === 'kk' || language === 'en' ? language : 'ru';
}
