import { z } from 'zod';

import { err, ok, type Result } from '@/domain/shared/result';
import { supabase } from '@/lib/supabase/client';

const ProfilePreferencesSchema = z.object({
  locale: z.enum(['ru', 'kk', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
});
export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>;

/** Language and appearance saved on the profile, so they follow the user across devices. */
export async function loadPreferences(userId: string): Promise<ProfilePreferences | null> {
  const { data, error } = await supabase.from('profiles').select('locale, theme').eq('id', userId).maybeSingle();
  if (error !== null || data === null) return null;
  const parsed = ProfilePreferencesSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function savePreferences(userId: string, preferences: Partial<ProfilePreferences>): Promise<void> {
  await supabase.from('profiles').update(preferences).eq('id', userId);
}

/**
 * Deletes the account and all data (PRD AUTH-4, App Store requirement) through the
 * delete-account Edge Function, then clears the local session.
 */
export async function deleteAccount(): Promise<Result<void, 'failed'>> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error !== null) return err('failed');
  await supabase.auth.signOut({ scope: 'local' });
  return ok(undefined);
}
