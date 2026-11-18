import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { z } from 'zod';

import { aesGcmCipher, keychainKeyStore } from './aes-cipher';
import type { Database } from './database.types';
import { EncryptedStorage } from './encrypted-storage';

/**
 * The app's Supabase client. Only public values reach the bundle (CLAUDE.md rule 5): the project
 * URL and the anon/publishable key. Expo inlines EXPO_PUBLIC_* at build time, so they must be
 * referenced literally here.
 */
const env = z
  .object({
    url: z.url(),
    anonKey: z.string().min(20),
  })
  .parse({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });

export const supabase = createClient<Database>(env.url, env.anonKey, {
  auth: {
    storage: new EncryptedStorage({ keyStore: keychainKeyStore, valueStore: AsyncStorage, cipher: aesGcmCipher }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** RPCs live in the `api` schema (DATABASE.md §8). */
export const api = () => supabase.schema('api');

// Refresh tokens only while the app is in the foreground (Supabase guidance for React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
