/**
 * Screen 8 — Идэвхтэй уулзалт (Active visit)
 *
 * A running timer, who is being met, and one large finish button.
 *
 * The timer counts from `started_at_server` — the SERVER's clock, fetched at
 * check-in — not from when this screen opened and not from the device clock.
 * Reopening the app mid-visit therefore shows the true elapsed time, and
 * changing the phone's clock does not alter it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { checkOut, fetchActiveVisit, type ActiveVisit } from '../../../src/data/visits';
import { readCurrentPosition, type LocationFailure } from '../../../src/lib/location';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  PrimaryButton,
} from '../../../src/components/ui';
import { mn } from '../../../src/lib/i18n/mn';
import { formatDurationMn, formatTimeMn } from '../../../src/lib/datetime';
import { colors, radius, spacing, typography } from '../../../src/theme';

export default function ActiveVisitScreen() {
  const router = useRouter();

  const [visit, setVisit] = useState<ActiveVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const clientUuid = useRef<string>(Crypto.randomUUID());
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchActiveVisit();
    setVisit(result.data ?? null);
    setError(result.error);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Tick once a second, always recomputing from the server start time rather
  // than incrementing a counter — so it stays correct after backgrounding.
  useEffect(() => {
    if (!visit) return;

    const started = new Date(visit.started_at_server).getTime();
    const endpoint = visit.completed_at_server
      ? new Date(visit.completed_at_server).getTime()
      : null;

    const update = () => {
      const now = endpoint ?? Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - started) / 1000)));
    };

    update();
    if (endpoint) return;   // finished: the duration is fixed, no need to tick

    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [visit]);

  const locationMessage = (failure: LocationFailure): string => {
    switch (failure) {
      case 'permission_denied':
        return mn.today.locationDenied;
      case 'services_disabled':
        return mn.today.locationServicesOff;
      case 'timeout':
        return mn.today.locationTimeout;
      default:
        return mn.today.locationUnavailable;
    }
  };

  const doFinish = async () => {
    if (!visit || finishing) return;

    setFinishing(true);
    const position = await readCurrentPosition('high');

    if (!position.ok) {
      setFinishing(false);
      Alert.alert(mn.activeVisit.finish, locationMessage(position.failure));
      return;
    }

    const result = await checkOut({
      visitId: visit.visit_id,
      latitude: position.reading.latitude,
      longitude: position.reading.longitude,
      accuracyM: position.reading.accuracyM,
      deviceTimestamp: position.reading.deviceTimestamp,
      isMocked: position.reading.isMocked,
      clientUuid: clientUuid.current,
      appVersion,
    });
    setFinishing(false);

    if (result.error) {
      Alert.alert(mn.common.error, result.error);
      return;
    }

    Alert.alert(mn.activeVisit.title, mn.activeVisit.checkedOut);
    await load();
  };

  const confirmFinish = () => {
    Alert.alert(mn.activeVisit.finish, mn.activeVisit.finishConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      { text: mn.activeVisit.finish, onPress: () => void doFinish() },
    ]);
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!visit) return <EmptyState label={mn.activeVisit.noActiveVisit} />;

  const checkedOut = visit.completed_at_server !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.timerBox, checkedOut && styles.timerBoxDone]}>
        <Text style={styles.timerLabel}>{mn.activeVisit.elapsed}</Text>
        <Text style={styles.timer}>{formatClock(elapsedSeconds)}</Text>
        <Text style={styles.timerSub}>
          {mn.activeVisit.startedAt(formatTimeMn(visit.started_at_server))}
        </Text>
        <Text style={styles.timerSub}>{formatDurationMn(elapsedSeconds)}</Text>
      </View>

      <Card>
        <Text style={styles.clinicName}>{visit.clinic_name}</Text>
        <Text style={styles.muted}>{visit.clinic_address}</Text>

        {visit.doctor_names.length > 0 ? (
          <>
            <Text style={styles.label}>{mn.visitDetail.doctors}</Text>
            <Text style={styles.value}>{visit.doctor_names.join(', ')}</Text>
          </>
        ) : null}

        {visit.brand_names.length > 0 ? (
          <>
            <Text style={styles.label}>{mn.visitDetail.brands}</Text>
            <View style={styles.chipRow}>
              {visit.brand_names.map((brand) => (
                <Chip key={brand} label={brand} />
              ))}
            </View>
          </>
        ) : null}

        {visit.objective ? (
          <>
            <Text style={styles.label}>{mn.visitDetail.objective}</Text>
            <Text style={styles.value}>{visit.objective}</Text>
          </>
        ) : null}
      </Card>

      {checkedOut ? (
        <>
          <View style={styles.doneBanner}>
            <Pill label={mn.activeVisit.awaitingReport} tone="warning" />
            <Text style={styles.doneText}>{mn.activeVisit.awaitingReportHint}</Text>
          </View>
          <PrimaryButton
            label={mn.completeVisit.title}
            onPress={() => router.push(`/report/${visit.visit_id}`)}
          />
        </>
      ) : (
        <PrimaryButton
          label={finishing ? mn.activeVisit.finishing : mn.activeVisit.finish}
          onPress={confirmFinish}
          busy={finishing}
        />
      )}

      <Text style={styles.notice}>{mn.startVisit.locationNotice}</Text>
    </ScrollView>
  );
}

/** HH:MM:SS, monospaced-feeling, readable across a room. */
function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  timerBox: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  timerBoxDone: { backgroundColor: colors.neutral },
  timerLabel: { ...typography.label, color: colors.primaryLight },
  timer: { fontSize: 48, fontWeight: '700', color: colors.onPrimary, letterSpacing: 2 },
  timerSub: { ...typography.caption, color: colors.primaryLight },

  clinicName: { ...typography.heading, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },
  value: { ...typography.body, color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  doneBanner: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  doneText: { ...typography.body, color: colors.warning, lineHeight: 21 },

  notice: { ...typography.caption, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
