import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, radius, spacing, typography } from './tokens';

export type TextFieldProps = Omit<TextInputProps, 'style'> & Readonly<{ label: string; error?: string }>;

/** Labelled text input with an optional error message (announced to VoiceOver). */
export function TextField({ label, error, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="footnote" color="textSecondary">
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.bgSurface,
            borderColor: error === undefined ? colors.borderSubtle : colors.negative,
          },
        ]}
      />
      {error !== undefined && (
        <Text variant="footnote" color="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
