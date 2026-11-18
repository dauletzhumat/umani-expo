import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from './text';
import { useTheme } from './theme/theme-provider';
import { SCREEN_PADDING, spacing } from './tokens';

export type ScreenProps = Readonly<{
  /** Large title at the top of the content (tab roots have no navigation header). */
  title?: string;
  children: ReactNode;
}>;

/** Scrollable screen on the grouped background with safe-area handling. */
export function Screen({ title, children }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: colors.bgGrouped }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {title !== undefined && (
          <Text variant="title1" accessibilityRole="header">
            {title}
          </Text>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: SCREEN_PADDING, gap: spacing.lg },
});
