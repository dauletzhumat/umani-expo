import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, radius, spacing } from './tokens';

export type Chip<T extends string> = Readonly<{ value: T; label: string; detail?: string }>;

export type ChipGroupProps<T extends string> = Readonly<{
  chips: readonly Chip<T>[];
  value: T | null;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}>;

/** Wrapping single-choice chips (radio group semantics): many short options, one tap each. */
export function ChipGroup<T extends string>({ chips, value, onChange, accessibilityLabel }: ChipGroupProps<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.wrap}>
      {chips.map((chip) => {
        const selected = chip.value === value;
        return (
          <Pressable
            key={chip.value}
            accessibilityRole="radio"
            accessibilityLabel={chip.detail === undefined ? chip.label : `${chip.label}, ${chip.detail}`}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(chip.value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.accentSubtle : colors.bgSurface,
                borderColor: selected ? colors.accent : colors.borderSubtle,
              },
            ]}>
            <Text variant="callout" color={selected ? 'accent' : 'textPrimary'}>
              {chip.label}
            </Text>
            {chip.detail !== undefined && (
              <Text variant="caption" color="textSecondary">
                {chip.detail}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
