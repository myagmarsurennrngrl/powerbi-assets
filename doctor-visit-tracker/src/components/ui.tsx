/**
 * Shared UI building blocks.
 *
 * Every data screen in this app is required to render loading, empty, error
 * and offline states explicitly (docs/04 §4). These components make doing that
 * the easy path, so no screen silently shows a blank page.
 */
import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius, shadow, spacing, touch, typography } from '../theme';
import { mn } from '../lib/i18n/mn';

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------
export function Title({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

/** A label/value row, the workhorse of every detail screen. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.fieldValue}>{value === '' ? '—' : value}</Text>
      ) : (
        value ?? <Text style={styles.fieldValue}>—</Text>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Containers
// -----------------------------------------------------------------------------
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Buttons — 56 dp for the primary action, 48 dp otherwise.
// `busy` disables the button, which is how duplicate submissions are prevented.
// -----------------------------------------------------------------------------
export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && !inactive && styles.pressed,
        inactive && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------
export function LabelledInput({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, error ? styles.inputError : null, props.style]}
      />
      {hint && !error ? <Text style={styles.caption}>{hint}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Status pills and badges
// -----------------------------------------------------------------------------
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneStyles: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.warningBg, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  info: { bg: colors.infoBg, fg: colors.info },
  neutral: { bg: colors.neutralBg, fg: colors.neutral },
};

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { bg, fg } = toneStyles[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/**
 * A two-button choice, used wherever a record is switched between active and
 * inactive. Two labelled buttons rather than a switch, because a switch does
 * not say what "off" means and these decisions have consequences.
 */
export function ChoiceButton({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[
        styles.choice,
        selected && styles.choiceSelected,
        disabled && styles.choiceDisabled,
      ]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ActiveToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <View style={styles.choiceRow}>
        <ChoiceButton
          label={mn.common.active}
          selected={value}
          disabled={disabled}
          onPress={() => onChange(true)}
        />
        <ChoiceButton
          label={mn.common.inactive}
          selected={!value}
          disabled={disabled}
          onPress={() => onChange(false)}
        />
      </View>
      <Text style={styles.caption}>{mn.admin.isActiveHint}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// The four mandatory data states
// -----------------------------------------------------------------------------
export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.stateText}>{label ?? mn.common.loading}</Text>
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.stateBox}>
      <Text style={styles.stateEmoji}>🗂️</Text>
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.stateBox}>
      <Text style={styles.stateEmoji}>⚠️</Text>
      <Text style={styles.stateText}>{message}</Text>
      {onRetry ? (
        <View style={styles.stateAction}>
          <SecondaryButton label={mn.common.retry} onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>
        {mn.common.offline} · {mn.common.offlineHint}
      </Text>
    </View>
  );
}

/**
 * An honest placeholder. Used wherever a screen or control is visible but the
 * feature is not built yet — never a button that silently does nothing.
 */
export function NotImplemented({ what, hint }: { what?: string; hint?: string }) {
  return (
    <View style={styles.notImplemented}>
      <Text style={styles.notImplementedTitle}>
        {what ? `${what} — ${mn.common.notImplemented}` : mn.common.notImplemented}
      </Text>
      <Text style={styles.caption}>{hint ?? mn.common.notImplementedHint}</Text>
    </View>
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
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

// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },

  title: { ...typography.title, color: colors.text },
  heading: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.text },
  muted: { color: colors.textMuted },
  caption: { ...typography.caption, color: colors.textMuted },

  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },

  field: { gap: 2, paddingVertical: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textMuted },
  fieldValue: { ...typography.body, color: colors.text },

  primaryButton: {
    minHeight: touch.primaryButton,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { ...typography.bodyStrong, color: colors.onPrimary, fontSize: 17 },

  secondaryButton: {
    minHeight: touch.button,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { ...typography.bodyStrong, color: colors.primary },

  pressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.45 },

  inputGroup: { gap: spacing.xs },
  input: {
    minHeight: touch.button,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    ...typography.body,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger },

  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: { ...typography.caption, fontWeight: '600' },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  chipText: { ...typography.caption, color: colors.primaryDark, fontWeight: '600' },

  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    paddingHorizontal: spacing.md,
    // 42 pt keeps the target comfortably tappable with cold hands in a corridor.
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceDisabled: { opacity: 0.45 },
  choiceText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  choiceTextSelected: { color: colors.onPrimary },

  stateBox: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  stateEmoji: { fontSize: 34 },
  stateText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  stateAction: { minWidth: 160 },

  offlineBanner: {
    backgroundColor: colors.warningBg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  offlineText: { ...typography.caption, color: colors.warning, fontWeight: '600' },

  notImplemented: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    gap: spacing.xs,
  },
  notImplementedTitle: { ...typography.bodyStrong, color: colors.textMuted },
});

export { styles as uiStyles };
