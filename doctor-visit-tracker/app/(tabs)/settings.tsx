/**
 * Screen 21 — Тохиргоо (Settings)
 *
 * Doubles as the privacy disclosure screen. A representative can read here, in
 * Mongolian, exactly when the app touches their location and confirm that
 * audio recording does not exist. Transparency is the mitigation for the
 * biggest risk in this project (docs/07-risks.md P1).
 */
import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSession } from '../../src/lib/auth';
import {
  Card,
  Field,
  NotImplemented,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { userRoleMn } from '../../src/lib/i18n/enums';
import { colors, spacing, typography } from '../../src/theme';

export default function SettingsScreen() {
  const { profile, signOut } = useSession();

  const confirmSignOut = () => {
    Alert.alert(mn.auth.signOut, mn.auth.signOutConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      { text: mn.auth.signOut, style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title={mn.settings.account}>
        <Card>
          <Field label={mn.settings.name} value={profile?.full_name ?? '—'} />
          <Field label={mn.settings.email} value={profile?.email ?? '—'} />
          <Field
            label={mn.settings.role}
            value={profile ? userRoleMn[profile.role] : '—'}
          />
          <Field label={mn.settings.phone} value={profile?.phone ?? '—'} />
        </Card>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title={mn.settings.privacy}>
        <Card>
          <Text style={styles.policy}>{mn.settings.locationPolicy}</Text>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>{mn.settings.noBackgroundTracking}</Text>
            <Pill label={mn.common.inactive} tone="success" />
          </View>

          <View style={styles.divider} />

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>{mn.settings.audioRecording}</Text>
            <Pill label={mn.settings.audioRecordingOff} tone="neutral" />
          </View>
          <Text style={styles.caption}>{mn.settings.audioRecordingExplain}</Text>

          <View style={styles.divider} />

          <Text style={styles.caption}>{mn.doctors.noPatientInfo}</Text>
        </Card>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title={mn.settings.system}>
        <Card>
          <Field label={mn.settings.timezone} value={mn.settings.timezoneValue} />
          <Field
            label={mn.settings.appVersion}
            value={`${Constants.expoConfig?.version ?? '0.1.0'}`}
          />
        </Card>
      </Section>

      <Section title={mn.sync.title}>
        <NotImplemented
          what={mn.sync.title}
          hint="Офлайн ажиллагаа ба синк 7-р шатанд нэмэгдэнэ."
        />
      </Section>

      <View style={styles.actions}>
        <SecondaryButton
          label="Нууцлалын мэдэгдэл"
          onPress={() =>
            Alert.alert(
              mn.settings.privacy,
              `${mn.settings.locationPolicy}\n\n${mn.settings.audioRecordingExplain}\n\n${mn.doctors.noPatientInfo}`,
            )
          }
        />
        <PrimaryButton label={mn.auth.signOut} onPress={confirmSignOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  policy: { ...typography.body, color: colors.text, lineHeight: 23 },
  caption: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 40,
  },
  statusLabel: { ...typography.bodyStrong, color: colors.text, flex: 1 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  actions: { gap: spacing.sm, marginTop: spacing.md },
});
