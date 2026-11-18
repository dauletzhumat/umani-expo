import { Platform, type TextStyle } from 'react-native';

/**
 * Design tokens (DESIGN_SYSTEM.md §2). Components use these semantic names, never raw values.
 */

export type ColorScheme = 'light' | 'dark';

export type ColorTokens = Readonly<{
  bgCanvas: string;
  bgGrouped: string;
  bgSurface: string;
  bgSurfaceRaised: string;
  /** Selected segment / chip: lighter than its track in both themes (iOS convention). */
  bgSelected: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textOnAccent: string;
  accent: string;
  accentSubtle: string;
  positive: string;
  negative: string;
  warning: string;
  savings: string;
}>;

export const colors: Readonly<Record<ColorScheme, ColorTokens>> = {
  light: {
    bgCanvas: '#FFFFFF',
    bgGrouped: '#F5F5F7',
    bgSurface: '#FFFFFF',
    bgSurfaceRaised: '#FAFAFB',
    bgSelected: '#FFFFFF',
    borderSubtle: '#E6E6EA',
    textPrimary: '#0A0A0B',
    textSecondary: '#5B5D66',
    textTertiary: '#8E9099',
    textOnAccent: '#FFFFFF',
    accent: '#0E7C66',
    accentSubtle: '#E6F4F0',
    positive: '#1A7F37',
    negative: '#C9372C',
    warning: '#B26B00',
    savings: '#3B5BDB',
  },
  dark: {
    bgCanvas: '#000000',
    bgGrouped: '#0B0B0D',
    bgSurface: '#161618',
    bgSurfaceRaised: '#1E1E21',
    bgSelected: '#3A3A3F',
    borderSubtle: '#2A2A2E',
    textPrimary: '#F5F5F7',
    textSecondary: '#A1A3AB',
    textTertiary: '#6E7079',
    textOnAccent: '#04110D',
    accent: '#2BC4A0',
    accentSubtle: '#0F2A24',
    positive: '#3FB950',
    negative: '#FF6B5E',
    warning: '#F0B429',
    savings: '#7B93FF',
  },
};

export type TypographyVariant =
  | 'display'
  | 'amountL'
  | 'title1'
  | 'title2'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subhead'
  | 'footnote'
  | 'caption';

const fontFamily = Platform.select({ ios: 'System', default: undefined });

export const typography: Readonly<Record<TypographyVariant, TextStyle>> = {
  display: { fontFamily, fontSize: 40, lineHeight: 44, fontWeight: '700' },
  amountL: { fontFamily, fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title1: { fontFamily, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontFamily, fontSize: 22, lineHeight: 28, fontWeight: '600' },
  headline: { fontFamily, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontFamily, fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontFamily, fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subhead: { fontFamily, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: '500' },
};

/** 4-pt grid. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/** Minimum touch target (Apple HIG). */
export const MIN_TOUCH = 44;

/** Screen horizontal padding. */
export const SCREEN_PADDING = spacing.xl;
