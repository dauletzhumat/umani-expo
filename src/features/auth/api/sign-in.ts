import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { err, ok, type Result } from '@/domain/shared/result';
import { supabase } from '@/lib/supabase/client';

/**
 * Native Sign in with Apple / Google → supabase.auth.signInWithIdToken (ARCHITECTURE §5).
 * Tokens are never logged; the session is persisted only through the encrypted storage.
 */

export type SignInError = 'cancelled' | 'unavailable' | 'not_configured' | 'failed';

function randomNonce(): string {
  return (Crypto.randomUUID() + Crypto.randomUUID()).replaceAll('-', '');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

export async function signInWithApple(): Promise<Result<void, SignInError>> {
  if (!(await AppleAuthentication.isAvailableAsync())) return err('unavailable');

  // Apple receives the SHA-256 of the nonce, Supabase the raw value (replay protection).
  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    return errorCode(error) === 'ERR_REQUEST_CANCELED' ? err('cancelled') : err('failed');
  }
  if (credential.identityToken === null) return err('failed');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error !== null || data.user === null) return err('failed');

  // Apple sends the name only on the very first sign-in: keep it.
  const givenName = credential.fullName?.givenName ?? undefined;
  const familyName = credential.fullName?.familyName ?? undefined;
  const fullName = [givenName, familyName].filter(Boolean).join(' ');
  if (fullName !== '') {
    await supabase.auth.updateUser({ data: { full_name: fullName, given_name: givenName, family_name: familyName } });
    await supabase.from('profiles').update({ display_name: fullName.slice(0, 100) }).eq('id', data.user.id);
  }
  return ok(undefined);
}

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export function isGoogleConfigured(): boolean {
  return GOOGLE_IOS_CLIENT_ID !== '' && GOOGLE_WEB_CLIENT_ID !== '';
}

export async function signInWithGoogle(): Promise<Result<void, SignInError>> {
  if (!isGoogleConfigured()) return err('not_configured');
  // Loaded lazily: the native module exists only in development/production builds, not Expo Go.
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = await import(
    '@react-native-google-signin/google-signin'
  );
  GoogleSignin.configure({ iosClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID });
  try {
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return err('cancelled');
    const token = response.data.idToken;
    if (token === null) return err('failed');
    // Google's iOS SDK cannot pass a nonce, so the provider runs with skip_nonce_check (Supabase docs).
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
    return error === null ? ok(undefined) : err('failed');
  } catch (error) {
    return isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED ? err('cancelled') : err('failed');
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  // Offline or server error: still end the session on this device.
  if (error !== null) await supabase.auth.signOut({ scope: 'local' });
}
