/**
 * Screen 21 — Тохиргоо (Settings)
 *
 * Doubles as the privacy disclosure screen. A representative can read here, in
 * Mongolian, exactly when the app touches their location and confirm that
 * audio recording does not exist. Transparency is the mitigation for the
 * biggest risk in this project (docs/07-risks.md P1).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useSession } from '../../src/lib/auth';
import { useSync } from '../../src/lib/offline/SyncProvider';
import { storageStats } from '../../src/lib/offline/db';
import { describeAgeMn } from '../../src/domain/cachePolicy';
import {
  Card,
  Field,
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
  const { online, summary, syncing, sync, purge } = useSync();
  const router = useRouter();
  const [stats, setStats] = useState<{ cacheRows: number; outboxRows: number } | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await storageStats());
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats, summary.total]);

  /**
   * Signing out wipes the local database, including anything still queued.
   * Warning first is the difference between "I signed out" and "I lost six
   * visit reports and never found out".
   */
  const confirmSignOut = () => {
    const message =
      summary.total > 0
        ? `${mn.sync.signOutWithQueue(summary.total)}\n\n${mn.auth.signOutConfirm}`
        : mn.auth.signOutConfirm;

    Alert.alert(mn.auth.signOut, message, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.auth.signOut,
        style: 'destructive',
        onPress: async () => {
          await purge();
          await signOut();
        },
      },
    ]);
  };

  const confirmClearCache = () => {
    if (summary.total > 0) {
      // Clearing the cache also clears the outbox — they are one database.
      Alert.alert(mn.settings.clearCache, mn.sync.signOutWithQueue(summary.total));
      return;
    }
    Alert.alert(mn.settings.clearCache, mn.settings.clearCacheConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.settings.clearCache,
        style: 'destructive',
        onPress: async () => {
          await purge();
          await loadStats();
          Alert.alert(mn.settings.clearCache, mn.sync.clearedCache);
        },
      },
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

          {/* The only way to change your own password. There is no email-based
              reset — see src/lib/auth/types.ts — so this is also the only way
              to get off an administrator-issued one. */}
          <SecondaryButton
            label={mn.auth.changePassword}
            onPress={() => router.push('/change-password')}
          />
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
        <Card>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>
              {online ? mn.sync.online : mn.sync.offline}
            </Text>
            <Pill
              label={
                summary.total === 0 ? mn.sync.allSynced : mn.sync.queueCount(summary.total)
              }
              tone={summary.blocked > 0 ? 'danger' : summary.total > 0 ? 'warning' : 'success'}
            />
          </View>

          {summary.oldestPendingAt !== null ? (
            <Text style={styles.caption}>
              {mn.sync.oldestPending(describeAgeMn(summary.oldestPendingAt, Date.now()))}
            </Text>
          ) : null}

          <Text style={styles.caption}>
            {stats ? mn.sync.storageRows(stats.cacheRows, stats.outboxRows) : mn.common.loading}
          </Text>

          <SecondaryButton
            label={syncing ? mn.sync.syncing : mn.sync.syncNow}
            onPress={() => void sync()}
            disabled={syncing || summary.total === 0}
          />
          <SecondaryButton label={mn.sync.title} onPress={() => router.push('/sync')} />
          <SecondaryButton label={mn.settings.clearCache} onPress={confirmClearCache} />
        </Card>
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
