import { Pressable, StyleSheet } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, radius, spacing, type ColorTokens } from './tokens';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export type ButtonProps = Readonly<{
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'L' | 'M';
  disabled?: boolean;
  accessibilityHint?: string;
}>;

const BACKGROUND: Readonly<Record<ButtonVariant, keyof ColorTokens | null>> = {
  primary: 'accent',
  secondary: 'accentSubtle',
  ghost: null,
  destructive: 'negative',
};

const FOREGROUND: Readonly<Record<ButtonVariant, keyof ColorTokens>> = {
  primary: 'textOnAccent',
  secondary: 'accent',
  ghost: 'accent',
  destructive: 'textOnAccent',
};

export function Button({ label, onPress, variant = 'primary', size = 'L', disabled = false, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const background = BACKGROUND[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: size === 'L' ? 52 : MIN_TOUCH },
        background !== null && { backgroundColor: colors[background] },
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 },
      ]}>
      <Text variant="headline" color={FOREGROUND[variant]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.xl,
  },
});
