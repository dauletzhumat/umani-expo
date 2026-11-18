import { View, type ViewProps } from 'react-native';

import { useTheme } from './theme/theme-provider';
import { radius, spacing } from './tokens';

export type SurfaceProps = ViewProps & Readonly<{ raised?: boolean; padded?: boolean }>;

/** A card on the grouped background (DESIGN_SYSTEM §3). */
export function Surface({ raised = false, padded = true, style, ...rest }: SurfaceProps) {
  const { colors } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: raised ? colors.bgSurfaceRaised : colors.bgSurface,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    />
  );
}
