import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme/theme-provider';
import { radius, SCREEN_PADDING, spacing } from '@/ui/tokens';

import { isGoogleConfigured, signInWithApple, signInWithGoogle, type SignInError } from '../api/sign-in';

/** Sign in with Apple (required by App Store guideline 4.8 alongside Google) and Google (PRD AUTH-1/2). */
export function SignInScreen() {
  const { t } = useTranslation();
  const { scheme, colors } = useTheme();
  const [error, setError] = useState<SignInError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(signIn: () => Promise<{ ok: boolean; error?: SignInError }>) {
    setBusy(true);
    setError(null);
    const result = await signIn();
    setBusy(false);
    if (!result.ok && result.error !== undefined && result.error !== 'cancelled') setError(result.error);
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bgCanvas }]}>
      <View style={styles.hero}>
        <Text variant="display" accessibilityRole="header">
          UMANI
        </Text>
        <Text variant="title2" color="textSecondary">
          {t('auth.tagline')}
        </Text>
      </View>

      <View style={styles.actions}>
        {error !== null && (
          <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t(error === 'unavailable' ? 'auth.errorUnavailable' : 'auth.errorFailed')}
          </Text>
        )}
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={radius.md}
          style={styles.appleButton}
          onPress={() => {
            if (!busy) void run(signInWithApple);
          }}
        />
        {isGoogleConfigured() && (
          <Button
            label={t('auth.continueWithGoogle')}
            variant="secondary"
            disabled={busy}
            onPress={() => void run(signInWithGoogle)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { flex: 1, justifyContent: 'center', paddingHorizontal: SCREEN_PADDING, gap: spacing.sm },
  actions: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing.xxl, gap: spacing.md },
  appleButton: { height: 52 },
});
