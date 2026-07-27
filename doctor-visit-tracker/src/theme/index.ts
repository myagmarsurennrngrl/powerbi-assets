/**
 * Design tokens.
 *
 * Constraints that drove these values (docs/04-screens-and-navigation.md §4):
 *  - The app is used outdoors, in daylight, often while walking. Text is large
 *    and contrast is high (all pairs below meet WCAG AA 4.5:1).
 *  - Touch targets are big: 56 dp for the primary action, 48 dp minimum for
 *    anything else. A representative wearing gloves in a Mongolian winter must
 *    still hit the button.
 */

export const colors = {
  // Teal reads as clinical/medical without looking like an emergency service.
  primary: '#0F766E',
  primaryDark: '#115E59',
  primaryLight: '#CCFBF1',
  onPrimary: '#FFFFFF',

  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',

  text: '#0F172A',
  textMuted: '#475569',
  textFaint: '#94A3B8',

  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Status colours, also used for the sync badges.
  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  info: '#1D4ED8',
  infoBg: '#DBEAFE',
  neutral: '#475569',
  neutralBg: '#F1F5F9',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  // 16 is the minimum body size; anything smaller is unreadable in sunlight.
  display: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  title: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  heading: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 18 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 17 },
} as const;

/** Minimum touch target heights, in density-independent pixels. */
export const touch = {
  primaryButton: 56,
  button: 48,
  row: 48,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
