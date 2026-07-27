import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { authProvider, AuthError } from '@/services/auth';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
import { Button, Field, Muted, Screen, Title } from '@/ui/components';

/** Matches Supabase's default OTP length. */
const CODE_LENGTH = 6;
/** Stops accidental e-mail flooding from repeated taps. */
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email ?? '').toLowerCase();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Landing here without an e-mail means the navigation state is broken;
  // sending the user back is better than showing a form that cannot work.
  useEffect(() => {
    if (email.length === 0) router.replace('/(auth)/login');
  }, [email]);

  async function onVerify() {
    setError(null);
    setBusy(true);
    try {
      await authProvider.verifyOtp(email, code);
      // AuthContext picks the new session up through onAuthStateChange and the
      // index route redirects; nothing else to do here.
      router.replace('/');
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setBusy(true);
    try {
      await authProvider.requestOtp(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: mn.auth.verifyTitle }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Screen>
          <View style={styles.header}>
            <Title>{mn.auth.verifyTitle}</Title>
            <Muted>{mn.auth.verifySubtitle}</Muted>
            <Muted>{email}</Muted>
          </View>

          <Field
            testID="verify-code"
            label={mn.auth.codeLabel}
            value={code}
            onChangeText={(v) => {
              setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH));
              if (error) setError(null);
            }}
            placeholder="000000"
            keyboardType="number-pad"
            autoCapitalize="none"
            error={error ?? undefined}
            maxLength={CODE_LENGTH}
          />

          <Button
            label={busy ? mn.auth.verifying : mn.auth.verify}
            onPress={onVerify}
            busy={busy}
            disabled={code.length !== CODE_LENGTH}
          />

          <View style={{ marginTop: spacing.md }}>
            <Button
              label={cooldown > 0 ? mn.auth.resendIn(cooldown) : mn.auth.resend}
              onPress={onResend}
              variant="secondary"
              disabled={cooldown > 0 || busy}
            />
          </View>
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof AuthError) {
    switch (e.code) {
      case 'wrong_code':
        return mn.auth.errorWrongCode;
      case 'domain_not_allowed':
        return mn.auth.errorDomainNotAllowed;
      case 'not_provisioned':
        return mn.auth.errorNotProvisioned;
      case 'rate_limited':
        return mn.auth.errorTooManyRequests;
      case 'network':
        return mn.auth.errorNetwork;
      default:
        return mn.auth.errorGeneric;
    }
  }
  return mn.auth.errorGeneric;
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.md },
});
