import type { TFunction } from 'i18next';

import { isCategoryNameKey, isEnvelopeNameKey, type Category, type SpendEnvelope } from '../model/expense';

/** Preset envelopes and default categories are i18n keys; custom ones carry their own name. */
export function envelopeLabel(envelope: Pick<SpendEnvelope, 'name' | 'nameKey'>, t: TFunction): string {
  return isEnvelopeNameKey(envelope.nameKey) ? t(envelope.nameKey) : (envelope.name ?? '');
}

/** A rename clears name_key in the database, so a set name always wins. */
export function categoryLabel(category: Pick<Category, 'name' | 'nameKey'>, t: TFunction): string {
  if (category.name !== null) return category.name;
  return isCategoryNameKey(category.nameKey) ? t(category.nameKey) : '';
}

export function localeOf(language: string): 'ru' | 'kk' | 'en' {
  return language === 'kk' || language === 'en' ? language : 'ru';
}
