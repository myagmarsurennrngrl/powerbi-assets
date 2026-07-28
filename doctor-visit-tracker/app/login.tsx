/**
 * Screen 1 — Нэвтрэх (Login)
 *
 * Two steps: type the work email, then type the one-time code that arrives by
 * email. No password to forget or leak.
 *
 * The code's length is a Supabase project setting (6 to 10), not a constant —
 * see src/domain/otp.ts for what assuming 6 cost.
 *
 * The domain restriction is checked here for a fast, clear message, but it is
 * ENFORCED by the database (migration 0006). If this screen were bypassed
 * entirely, an unapproved address still could not sign in.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthError, useSession } from '../src/lib/auth';
import { getConfigError, getConfigProblem } from '../src/lib/supabase';
import { LabelledInput, PrimaryButton, SecondaryButton } from '../src/components/ui';
import { mn } from '../src/lib/i18n/mn';
import { OTP_MAX_LENGTH, isSubmittableOtp, sanitiseOtpInput } from '../src/domain/otp';
import { colors, radius, spacing, typography } from '../src/theme';

const RESEND_COOLDOWN_SECONDS = 60;

export default function LoginScreen() {
  const { auth, refreshProfile } = useSession();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The provider's raw message, shown under the friendly one. See detailFor. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const configMissing = getConfigError();
  /** Present-but-wrong, e.g. a URL with quotation marks round it. */
  const configProblem = getConfigProblem();

  // Cooldown between "resend code" presses — a small client-side brake on top
  // of Supabase's own server-side rate limiting.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown]);

  const messageFor = (err: unknown): string => {
    if (err instanceof AuthError) {
      switch (err.code) {
        case 'domain_not_allowed':
          return mn.auth.errorDomainNotAllowed;
        case 'invalid_code':
          return mn.auth.errorInvalidCode;
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
   * undiagnosable for whoever they ask. "Signups not allowed for otp" and
   * "email rate limit exceeded" need completely different responses, and the
   * app was hiding which one had happened.
   *
   * Shown small and secondary: the Mongolian sentence is still the message.
   */
  const detailFor = (err: unknown): string | null => {
    if (err instanceof AuthError && err.code !== 'domain_not_allowed') {
      const raw = err.message?.trim();
      if (raw && raw.toLowerCase() !== 'unknown authentication error') return raw;
    }
    return null;
  };

  const handleRequestCode = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(mn.auth.errorEmailRequired);
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError(mn.auth.errorEmailInvalid);
      return;
    }

    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      await auth.requestCode(trimmed);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(messageFor(err));
      setErrorDetail(detailFor(err));
    } finally {
      setBusy(false);
    }
  }, [auth, email]);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) {
      setError(mn.auth.errorCodeRequired);
      return;
    }
    if (!isSubmittableOtp(code)) {
      setError(mn.auth.errorCodeTooShort);
      return;
    }

    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      await auth.verifyCode(email.trim(), code.trim());
      // The root layout reacts to the session change; refreshing the profile
      // makes the transition immediate rather than waiting for the listener.
      await refreshProfile();
    } catch (err) {
      setError(messageFor(err));
      setErrorDetail(detailFor(err));
    } finally {
      setBusy(false);
    }
  }, [auth, code, email, refreshProfile]);

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
            {step === 'email' ? (
              <>
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
                  error={error}
                  onSubmitEditing={() => void handleRequestCode()}
                  returnKeyType="send"
                />
                {errorDetail ? (
                  <View style={styles.detailBox}>
                    <Text style={styles.detailLabel}>{mn.auth.errorDetailLabel}</Text>
                    <Text style={styles.detailText} selectable>
                      {errorDetail}
                    </Text>
                  </View>
                ) : null}
                <PrimaryButton
                  label={busy ? mn.auth.sendingCode : mn.auth.sendCode}
                  onPress={() => void handleRequestCode()}
                  busy={busy}
                  disabled={!!configMissing}
                />
              </>
            ) : (
              <>
                <Text style={styles.sentTo}>{mn.auth.codeSentTo(email.trim())}</Text>
                <LabelledInput
                  label={mn.auth.codeLabel}
                  placeholder={mn.auth.codePlaceholder}
                  value={code}
                  onChangeText={(text) => {
                    setCode(sanitiseOtpInput(text));
                    setError(null);
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={OTP_MAX_LENGTH}
                  editable={!busy}
                  error={error}
                  style={styles.codeInput}
                  onSubmitEditing={() => void handleVerify()}
                  returnKeyType="go"
                />
                {errorDetail ? (
                  <View style={styles.detailBox}>
                    <Text style={styles.detailLabel}>{mn.auth.errorDetailLabel}</Text>
                    <Text style={styles.detailText} selectable>
                      {errorDetail}
                    </Text>
                  </View>
                ) : null}
                <PrimaryButton
                  label={busy ? mn.auth.verifying : mn.auth.verify}
                  onPress={() => void handleVerify()}
                  busy={busy}
                />
                <SecondaryButton
                  label={cooldown > 0 ? mn.auth.resendIn(cooldown) : mn.auth.resendCode}
                  onPress={() => void handleRequestCode()}
                  disabled={busy || cooldown > 0}
                />
                <SecondaryButton
                  label={mn.auth.changeEmail}
                  onPress={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                  }}
                  disabled={busy}
                />
              </>
            )}
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
  // impossible; diagnosing "Signups not allowed for otp" takes seconds.
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
  sentTo: { ...typography.body, color: colors.textMuted },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },

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
