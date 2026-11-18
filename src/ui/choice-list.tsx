import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, radius, spacing } from './tokens';

export type Choice<T extends string> = Readonly<{ value: T; label: string }>;

export type ChoiceListProps<T extends string> = Readonly<{
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}>;

/** Vertical single-choice list (radio group semantics), for options with longer labels. */
export function ChoiceList<T extends string>({ choices, value, onChange, accessibilityLabel }: ChoiceListProps<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.list}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(choice.value)}
            style={[
              styles.row,
              {
                backgroundColor: selected ? colors.accentSubtle : colors.bgSurface,
                borderColor: selected ? colors.accent : colors.borderSubtle,
              },
            ]}>
            <Text variant="body" style={styles.label}>
              {choice.label}
            </Text>
            {selected && (
              <Text variant="headline" color="accent" importantForAccessibility="no" accessibilityElementsHidden>
                ✓
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
});
