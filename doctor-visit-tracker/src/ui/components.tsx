/**
 * Shared UI primitives.
 *
 * Everything here is built for outdoor, one-handed, on-the-move use:
 * large touch targets, high contrast, and status always carrying a text
 * label as well as a colour.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, radius, shadow, spacing, TOUCH_TARGET } from '@/theme/tokens';
import { mn } from '@/i18n/mn';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  fullWidth = true,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
}) {
  // `busy` disables the button as well as `disabled`, which is what prevents a
  // double submission when someone taps twice on a slow connection.
  const isOff = disabled || busy;

  const background = isOff
    ? colors.disabled
    : variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : colors.surface;

  const textColor = isOff
    ? colors.disabledText
    : variant === 'secondary'
      ? colors.primary
      : colors.textInverse;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy }}
      accessibilityHint={accessibilityHint}
      disabled={isOff}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        variant === 'secondary' && !isOff && styles.buttonOutlined,
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isOff && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonLabel, { color: textColor }]} numberOfLines={2}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badge — colour is always accompanied by a label
// ---------------------------------------------------------------------------
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.disabled, fg: colors.text },
  success: { bg: colors.successLight, fg: colors.success },
  warning: { bg: colors.warningLight, fg: colors.warning },
  danger: { bg: colors.dangerLight, fg: colors.danger },
  info: { bg: colors.primaryLight, fg: colors.primary },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const t = BADGE_TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  multiline = false,
  editable = true,
  maxLength,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  editable?: boolean;
  maxLength?: number;
  testID?: string;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.disabledText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        editable={editable}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          !editable && styles.inputDisabled,
          !!error && styles.inputError,
        ]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Chip row — used everywhere instead of free typing where possible. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.fieldWrapper}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(opt.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <Text style={styles.body}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen-level states — every data screen renders all four
// ---------------------------------------------------------------------------
export function LoadingState({ label = mn.common.loading }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.muted, { marginTop: spacing.md }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.emptyIcon}>—</Text>
      <Text style={styles.body}>{message}</Text>
      {hint ? <Text style={[styles.muted, { marginTop: spacing.sm }]}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={[styles.heading, { color: colors.danger }]}>{mn.common.error}</Text>
      <Text style={[styles.body, { textAlign: 'center', marginTop: spacing.sm }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
          <Button label={mn.common.retry} onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>{mn.common.offlineBanner}</Text>
    </View>
  );
}

/**
 * Used wherever a later phase will add functionality.
 * The requirement is explicit: no placeholder buttons, no fake features. A
 * screen either works or says plainly that it does not exist yet.
 */
export function NotImplemented({ what, phase }: { what: string; phase?: string }) {
  return (
    <View style={styles.notImplemented}>
      <Badge label={mn.common.notImplemented} tone="warning" />
      <Text style={[styles.body, { marginTop: spacing.sm }]}>{what}</Text>
      <Text style={[styles.muted, { marginTop: spacing.xs }]}>
        {phase ? `${mn.common.notImplementedHint} (${phase})` : mn.common.notImplementedHint}
      </Text>
    </View>
  );
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={styles.screen}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string | null | undefined;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, emphasis && styles.detailValueEmphasis]}>
        {value && value.length > 0 ? value : '—'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  title: { fontSize: fontSize.heading, fontWeight: '700', color: colors.text },
  heading: { fontSize: fontSize.title, fontWeight: '700', color: colors.text },
  body: { fontSize: fontSize.body, color: colors.text, lineHeight: 24 },
  muted: { fontSize: fontSize.caption + 1, color: colors.textMuted, lineHeight: 20 },

  button: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonOutlined: { borderWidth: 2, borderColor: colors.primary },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontSize: fontSize.bodyLarge, fontWeight: '700', textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadow.card,
  },
  cardPressed: { backgroundColor: colors.primaryLight },

  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: fontSize.caption, fontWeight: '700' },

  fieldWrapper: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.body, fontWeight: '600', color: colors.text },
  fieldHint: { fontSize: fontSize.caption, color: colors.textMuted },
  fieldError: { fontSize: fontSize.caption + 1, color: colors.danger, fontWeight: '600' },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.bodyLarge,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: TOUCH_TARGET * 2, textAlignVertical: 'top' },
  inputDisabled: { backgroundColor: colors.disabled, color: colors.disabledText },
  inputError: { borderColor: colors.danger, borderWidth: 2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.body, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.textInverse },

  toggleRow: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  toggleTrack: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: colors.success },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    minHeight: 220,
  },
  emptyIcon: { fontSize: 40, color: colors.disabledText, marginBottom: spacing.sm },

  offlineBanner: {
    backgroundColor: colors.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  offlineText: { color: colors.warning, fontWeight: '700', fontSize: fontSize.caption + 1 },

  notImplemented: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.lg,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailLabel: { fontSize: fontSize.body, color: colors.textMuted, flexShrink: 0 },
  detailValue: { fontSize: fontSize.body, color: colors.text, flex: 1, textAlign: 'right' },
  detailValueEmphasis: { fontWeight: '700' },
});
