/**
 * Design tokens.
 *
 * The app is used outdoors, in a car, and often one-handed. That drives every
 * choice here: high contrast, large text, generous touch targets, and status
 * colours that are always paired with a text label (sunlight and colour
 * blindness both make colour-only signals unreliable).
 */

export const colors = {
  primary: '#1B5E9B',
  primaryDark: '#164B7C',
  primaryLight: '#E8F1F9',

  success: '#137A4B',
  successLight: '#E6F4EC',
  warning: '#B45309',
  warningLight: '#FDF3E7',
  danger: '#B3261E',
  dangerLight: '#FBEAE9',

  text: '#1A1C1E',
  textMuted: '#5A5F66',
  textInverse: '#FFFFFF',

  surface: '#FFFFFF',
  background: '#F5F7FA',
  border: '#D8DEE6',
  borderStrong: '#B3BCC7',
  disabled: '#E4E8ED',
  disabledText: '#8A9199',
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
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  /** Never smaller than this — the app is read in daylight, on the move. */
  caption: 13,
  body: 16,
  bodyLarge: 18,
  title: 20,
  heading: 24,
} as const;

/** Minimum touch target, in density-independent pixels (Apple + Google guidance). */
export const TOUCH_TARGET = 48;

export const shadow = {
  card: {
    shadowColor: '#0B1F33',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
