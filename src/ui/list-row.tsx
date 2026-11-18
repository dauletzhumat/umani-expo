import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { MIN_TOUCH, spacing } from './tokens';

export type ListRowProps = Readonly<{
  title: string;
  subtitle?: string;
  /** Short trailing text (e.g. the current setting). */
  value?: string;
  /** Custom trailing content (e.g. an AmountText). */
  trailing?: ReactNode;
  onPress?: () => void;
}>;

/** Inset grouped row, iOS Settings style. Pressable rows get a chevron and the button role. */
export function ListRow({ title, subtitle, value, trailing, onPress }: ListRowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      <View style={styles.text}>
        <Text variant="body">{title}</Text>
        {subtitle !== undefined && (
          <Text variant="footnote" color="textSecondary">
            {subtitle}
          </Text>
        )}
      </View>
      {value !== undefined && (
        <Text variant="body" color="textSecondary">
          {value}
        </Text>
      )}
      {trailing}
      {onPress !== undefined && (
        <Text variant="title2" color="textTertiary" importantForAccessibility="no" accessibilityElementsHidden>
          ›
        </Text>
      )}
    </>
  );

  if (onPress === undefined) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value === undefined ? title : `${title}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSurfaceRaised }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: { flex: 1, gap: spacing.xxs },
});
