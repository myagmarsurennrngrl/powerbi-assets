/**
 * Screen — Нууц үг солих (Change your own password)
 *
 * Reached from Settings. Requires a live session: this is a change, not a
 * reset. Somebody who cannot sign in at all needs an administrator, and the
 * login screen says so.
 *
 * The rules live in src/domain/password.ts and are checked here BEFORE the
 * request, so the message is in Mongolian and names the actual problem.
 * Supabase's own minimum is looser and its error is in English.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AuthError, useSession } from '../src/lib/auth';
import { LabelledInput, PrimaryButton, SecondaryButton } from '../src/components/ui';
import { PASSWORD_MIN_LENGTH, checkPassword } from '../src/domain/password';
import { mn } from '../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../src/theme';

export default function ChangePasswordScreen() {
  const { auth, profile } = useSession();
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** One Mongolian sentence per rule, each naming the fix. */
  const messageForProblem = (problem: NonNullable<ReturnType<typeof checkPassword>>): string => {
    switch (problem) {
      case 'too_short':
        return mn.auth.errorPasswordTooShort(PASSWORD_MIN_LENGTH);
      case 'too_long':
        return mn.auth.errorPasswordTooLong;
      case 'same_as_email':
        return mn.auth.errorPasswordSameAsEmail;
      case 'too_obvious':
        return mn.auth.errorPasswordTooObvious;
      case 'only_one_character':
        return mn.auth.errorPasswordOneCharacter;
      case 'whitespace_only':
        return mn.auth.errorPasswordWhitespace;
    }
  };

  const handleSave = useCallback(async () => {
    const problem = checkPassword(password, profile?.email ?? '');
    if (problem) {
      setError(messageForProblem(problem));
      return;
    }
    // Compared before sending: a typo in a field you cannot read is the whole
    // reason this second field exists.
    if (password !== again) {
      setError(mn.auth.errorPasswordMismatch);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await auth.changePassword(password);
      Alert.alert(mn.auth.changePasswordTitle, mn.auth.changePasswordDone, [
        { text: mn.common.ok, onPress: () => router.back() },
      ]);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'weak_password') {
        setError(mn.auth.errorPasswordWeakServer);
      } else if (err instanceof AuthError && err.code === 'network') {
        setError(mn.auth.errorNetwork);
      } else {
        setError(mn.auth.errorGeneric);
      }
    } finally {
      setBusy(false);
    }
  }, [again, auth, password, profile?.email, router]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hint}>
          <Text style={styles.hintText}>{mn.auth.passwordRule(PASSWORD_MIN_LENGTH)}</Text>
        </View>

        <LabelledInput
          label={mn.auth.newPasswordLabel}
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError(null);
          }}
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
        />

        <LabelledInput
          label={mn.auth.newPasswordAgainLabel}
          value={again}
          onChangeText={(text) => {
            setAgain(text);
            setError(null);
          }}
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
          error={error}
          onSubmitEditing={() => void handleSave()}
          returnKeyType="go"
        />

        <Pressable onPress={() => setReveal((on) => !on)} hitSlop={8}>
          <Text style={styles.revealToggle}>
            {reveal ? mn.auth.passwordHide : mn.auth.passwordShow}
          </Text>
        </Pressable>

        <PrimaryButton
          label={busy ? mn.auth.changePasswordSaving : mn.auth.changePasswordSubmit}
          onPress={() => void handleSave()}
          busy={busy}
        />
        <SecondaryButton
          label={mn.common.cancel}
          onPress={() => router.back()}
          disabled={busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },

  hint: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintText: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  revealToggle: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'right',
  },
});
