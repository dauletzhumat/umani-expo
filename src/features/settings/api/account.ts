import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';

import { err, ok, type Result } from '@/domain/shared/result';
import { supabase } from '@/lib/supabase/client';

import { accountGoneFromAuthError } from '../model/delete-outcome';

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
  let { error } = await invokeDelete();
  // A 401 means the access token expired without a client-side refresh (the auto-refresh timer
  // pauses while the JS thread is suspended). Refresh once and retry; the server re-verifies.
  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error !== null) return err('failed');
    ({ error } = await invokeDelete());
  }
  if (error !== null && !(error instanceof FunctionsHttpError)) {
    // No response (network/relay): the deletion may still have happened. Ask the server.
    const { error: userError } = await supabase.auth.getUser();
    if (accountGoneFromAuthError(userError)) error = null;
  }
  if (error !== null) return err('failed');
  await supabase.auth.signOut({ scope: 'local' });
  return ok(undefined);
}

function invokeDelete() {
  return supabase.functions.invoke('delete-account', { method: 'POST' });
}
