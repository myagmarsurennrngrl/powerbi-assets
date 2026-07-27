import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { authProvider, AuthError } from '@/services/auth';
import { checkEmailAllowed } from '@/services/api';
import { checkLoginEmail } from '@/domain/email';
import { env } from '@/config/env';
import { mn } from '@/i18n/mn';
import { colors, spacing } from '@/theme/tokens';
import { Body, Button, Field, Muted, Screen, Title } from '@/ui/components';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);

    // Step 1 — cheap local check, purely so the user is not made to wait for a
    // code that can never arrive. Not a security control.
    const local = checkLoginEmail(email, env.allowedEmailDomains);
    if (!local.ok) {
      setError(
        local.reason === 'domain'
          ? mn.auth.errorDomainNotAllowed
          : mn.auth.errorInvalidEmail,
      );
      return;
    }

    setBusy(true);
    try {
      // Step 2 — ask the server whether this address can log in at all. This
      // catches "right domain, but no account created by the administrator"
      // before the person waits for an e-mail that will never come.
      const allowed = await checkEmailAllowed(local.email);
      if (!allowed) {
        setError(mn.auth.errorNotProvisioned);
        return;
      }

      // Step 3 — send the code. The database trigger is the real gate.
      await authProvider.requestOtp(local.email);
      router.push({ pathname: '/(auth)/verify', params: { email: local.email } });
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: mn.appName }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Screen>
          <View style={styles.header}>
            <Title>{mn.auth.loginTitle}</Title>
            <Muted>{mn.auth.loginSubtitle}</Muted>
          </View>

          <Field
            testID="login-email"
            label={mn.auth.emailLabel}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            placeholder={mn.auth.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            error={error ?? undefined}
            maxLength={254}
          />

          <Button
            label={busy ? mn.auth.sendingCode : mn.auth.sendCode}
            onPress={onSubmit}
            busy={busy}
            disabled={email.trim().length === 0}
          />

          <View style={styles.footer}>
            <Body style={{ color: colors.textMuted }}>
              {env.allowedEmailDomains.length > 0
                ? `Зөвшөөрөгдсөн домэйн: ${env.allowedEmailDomains
                    .map((d) => `@${d}`)
                    .join(', ')}`
                : ''}
            </Body>
          </View>
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof AuthError) {
    switch (e.code) {
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
  footer: { marginTop: spacing.xl },
});
