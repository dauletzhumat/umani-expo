import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, radius, spacing } from './tokens';

export type SegmentedOption<T extends string> = Readonly<{ value: T; label: string }>;

export type SegmentedControlProps<T extends string> = Readonly<{
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}>;

/** A small set of mutually exclusive choices (radio group semantics for VoiceOver). */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: colors.bgSurfaceRaised, borderColor: colors.borderSubtle }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={[styles.segment, selected && { backgroundColor: colors.bgSelected }]}>
            <Text variant="subhead" color={selected ? 'textPrimary' : 'textSecondary'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xxs,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.sm,
  },
});
