import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { useTheme } from './theme/theme-provider';
import { typography, type ColorTokens, type TypographyVariant } from './tokens';

export type TextProps = NativeTextProps &
  Readonly<{
    variant?: TypographyVariant;
    color?: keyof ColorTokens;
    /** Tabular figures, for amounts that should line up. */
    tabular?: boolean;
  }>;

/** Themed text. Scales with Dynamic Type (allowFontScaling is on by default). */
export function Text({ variant = 'body', color = 'textPrimary', tabular = false, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <NativeText
      {...rest}
      style={[typography[variant], { color: colors[color] }, tabular && { fontVariant: ['tabular-nums'] }, style]}
    />
  );
}
