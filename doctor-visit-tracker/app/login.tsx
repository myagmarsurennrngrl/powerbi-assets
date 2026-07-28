/**
 * Screen 1 — Нэвтрэх (Login)
 *
 * Work email plus a password. One step, one button.
 *
 * The domain restriction is checked here for a fast, clear message, but it is
 * ENFORCED by the database (migration 0006). If this screen were bypassed
 * entirely, an unapproved address still could not sign in.
 *
 * There is no "forgot password" flow, and that is not an omission — see
 * src/lib/auth/types.ts. Without working email delivery there is no way to
 * prove somebody owns a mailbox, so a reset is an administrator's job. The
 * screen says so rather than offering a button that cannot work.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthError, useSession } from '../src/lib/auth';
import { getConfigError, getConfigProblem } from '../src/lib/supabase';
import { LabelledInput, PrimaryButton } from '../src/components/ui';
import { mn } from '../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../src/theme';

export default function LoginScreen() {
  const { auth, refreshProfile } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const configMissing = getConfigError();
  /** Present-but-wrong, e.g. a URL with quotation marks round it. */
  const configProblem = getConfigProblem();

  const messageFor = (err: unknown): string => {
    if (err instanceof AuthError) {
      switch (err.code) {
        case 'domain_not_allowed':
          return mn.auth.errorDomainNotAllowed;
        case 'invalid_credentials':
          return mn.auth.errorInvalidCredentials;
        case 'network':
          return mn.auth.errorNetwork;
        case 'rate_limited':
          return mn.auth.errorRateLimited;
        default:
          return mn.auth.errorGeneric;
      }
    }
    return mn.auth.errorGeneric;
  };

  /**
   * The provider's own words, kept alongside the friendly message.
   *
   * Without this the screen said only «Нэвтрэхэд алдаа гарлаа» for every
   * unrecognised failure, which is unactionable for the person and
   * undiagnosable for whoever they ask.
   *
   * Withheld for the two cases where the English adds nothing and the
   * Mongolian already says everything: a rejected domain, and credentials that
   * simply do not match.
   */
  const detailFor = (err: unknown): string | null => {
    if (
      err instanceof AuthError &&
      err.code !== 'domain_not_allowed' &&
      err.code !== 'invalid_credentials'
    ) {
      const raw = err.message?.trim();
      if (raw && raw.toLowerCase() !== 'unknown authentication error') return raw;
    }
    return null;
  };

  const handleSignIn = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(mn.auth.errorEmailRequired);
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError(mn.auth.errorEmailInvalid);
      return;
    }
    // Only emptiness is checked. The length rules belong to CHOOSING a
    // password, not to typing an existing one — applying them here would lock
    // out anybody whose password predates the current rules.
    if (!password) {
      setError(mn.auth.errorPasswordRequired);
      return;
    }

    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      await auth.signIn(trimmed, password);
      // The root layout reacts to the session change; refreshing the profile
      // makes the transition immediate rather than waiting for the listener.
      await refreshProfile();
    } catch (err) {
      setError(messageFor(err));
      setErrorDetail(detailFor(err));
    } finally {
      setBusy(false);
    }
  }, [auth, email, password, refreshProfile]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.logo}>🩺</Text>
            <Text style={styles.appName}>{mn.app.name}</Text>
            <Text style={styles.subtitle}>{mn.auth.subtitle}</Text>
          </View>

          {configMissing ? (
            <View style={styles.configError}>
              <Text style={styles.configErrorTitle}>{mn.errors.configMissing}</Text>
              {/* A malformed value needs a different instruction from a
                  missing one: which line is wrong, not "fill in the file". */}
              <Text style={styles.configErrorDetail} selectable>
                {configProblem ?? configMissing.join(', ')}
              </Text>
              <Text style={styles.configErrorDetail}>{mn.errors.configHint}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <LabelledInput
              label={mn.auth.emailLabel}
              placeholder={mn.auth.emailPlaceholder}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              textContentType="emailAddress"
              editable={!busy}
              returnKeyType="next"
            />

            <LabelledInput
              label={mn.auth.passwordLabel}
              placeholder={mn.auth.passwordPlaceholder}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError(null);
              }}
              // Long passwords are hard to type correctly on a phone keyboard,
              // and a wrong one here costs an administrator's time. Revealing
              // is the lesser risk.
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              editable={!busy}
              error={error}
              onSubmitEditing={() => void handleSignIn()}
              returnKeyType="go"
            />

            <Pressable onPress={() => setReveal((on) => !on)} hitSlop={8}>
              <Text style={styles.revealToggle}>
                {reveal ? mn.auth.passwordHide : mn.auth.passwordShow}
              </Text>
            </Pressable>

            {errorDetail ? (
              <View style={styles.detailBox}>
                <Text style={styles.detailLabel}>{mn.auth.errorDetailLabel}</Text>
                <Text style={styles.detailText} selectable>
                  {errorDetail}
                </Text>
              </View>
            ) : null}

            <PrimaryButton
              label={busy ? mn.auth.signingIn : mn.auth.signIn}
              onPress={() => void handleSignIn()}
              busy={busy}
              disabled={!!configMissing}
            />

            <Pressable onPress={() => setShowHelp((on) => !on)} hitSlop={8}>
              <Text style={styles.helpToggle}>{mn.auth.passwordHelpToggle}</Text>
            </Pressable>

            {showHelp ? (
              <View style={styles.helpBox}>
                <Text style={styles.helpText}>{mn.auth.passwordHelpBody}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.footnote}>{mn.settings.locationPolicy}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Secondary to the Mongolian message, but selectable so it can be copied
  // into a support message. Diagnosing "it says an error occurred" is
  // impossible; diagnosing "Signups not allowed" takes seconds.
  detailBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  detailLabel: { ...typography.caption, color: colors.textFaint, fontWeight: '700' },
  detailText: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  safe: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' },

  header: { alignItems: 'center', gap: spacing.sm },
  logo: { fontSize: 56 },
  appName: { ...typography.display, color: colors.onPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.primaryLight, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },

  revealToggle: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'right',
  },
  helpToggle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  helpBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  helpText: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  configError: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  configErrorTitle: { ...typography.bodyStrong, color: colors.danger },
  configErrorDetail: { ...typography.caption, color: colors.danger },

  footnote: {
    ...typography.caption,
    color: colors.primaryLight,
    textAlign: 'center',
    lineHeight: 18,
  },
});
