/**
 * Screen 7 — Уулзалт эхлүүлэх (Start visit confirmation)
 *
 * The screen a representative sees standing outside a clinic. Its job is to
 * answer one question honestly: can I start, and if not, exactly why not.
 *
 * DESIGN NOTES
 * ------------
 * 1. All eight conditions are listed with a tick or a cross. A single greyed
 *    button with no explanation is what makes people distrust an app; "you are
 *    240 m away, the limit is 150 m" is something they can act on.
 * 2. The local check runs first for an instant answer, then the SERVER is
 *    asked and its verdict wins. They should always agree — a parity test
 *    enforces that — but if they ever differ, the user sees the truth.
 * 3. Location is read once per tap of «Дахин шалгах». No watcher.
 * 4. The start button disables itself on press and sends a stable client UUID,
 *    so a double tap or a network retry cannot create two visits.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { fetchPlannedVisit, type PlannedVisitDetail } from '../../../src/data/planning';
import { checkStartEligibility, startVisit, type ServerEligibility } from '../../../src/data/visits';
import { readCurrentPosition, type LocationFailure, type LocationReading } from '../../../src/lib/location';
import { formatDistanceMn } from '../../../src/domain/geo';
import { canRequestException } from '../../../src/domain/visitEligibility';
import {
  Card,
  ErrorState,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
} from '../../../src/components/ui';
import { mn } from '../../../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../../../src/theme';

export default function StartVisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [visit, setVisit] = useState<PlannedVisitDetail | null>(null);
  const [reading, setReading] = useState<LocationReading | null>(null);
  const [eligibility, setEligibility] = useState<ServerEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  /**
   * One UUID per screen mount. Reusing it across retries is what makes the
   * check-in idempotent: the server returns the existing visit instead of
   * creating a second one.
   */
  const clientUuid = useRef<string>(Crypto.randomUUID());
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

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

  /** Take one high-accuracy reading, then ask the server for its verdict. */
  const runCheck = useCallback(async () => {
    if (!id) return;
    setChecking(true);
    setLocationError(null);

    // 'high' rather than 'balanced': this reading decides whether a visit may
    // start, so precision matters more than battery here.
    const result = await readCurrentPosition('high');

    let position: { latitude: number; longitude: number; accuracyM: number | null } | null = null;
    if (result.ok) {
      setReading(result.reading);
      position = {
        latitude: result.reading.latitude,
        longitude: result.reading.longitude,
        accuracyM: result.reading.accuracyM,
      };
    } else {
      setReading(null);
      setLocationError(locationMessage(result.failure));
    }

    // The server's answer is the one that counts.
    const server = await checkStartEligibility(id, position);
    if (server.error) setError(server.error);
    setEligibility(server.data);

    setChecking(false);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      const result = await fetchPlannedVisit(id);
      if (cancelled) return;

      if (result.error || !result.data) {
        setError(result.error ?? mn.common.empty);
        setLoading(false);
        return;
      }
      setVisit(result.data);
      setLoading(false);
      await runCheck();
    })();
    return () => {
      cancelled = true;
    };
  }, [id, runCheck]);

  const handleStart = async () => {
    if (!id || !reading || starting) return;

    setStarting(true);
    const result = await startVisit({
      plannedVisitId: id,
      latitude: reading.latitude,
      longitude: reading.longitude,
      accuracyM: reading.accuracyM,
      deviceTimestamp: reading.deviceTimestamp,
      isMocked: reading.isMocked,
      clientUuid: clientUuid.current,
      appVersion,
    });
    setStarting(false);

    if (result.error || !result.data) {
      // The server's Mongolian message carries the actual numbers.
      Alert.alert(mn.startVisit.title, result.error ?? mn.common.error);
      await runCheck();
      return;
    }

    router.replace(`/visit/${id}/active`);
  };

  if (loading) return <LoadingState />;
  if (error && !visit) return <ErrorState message={error} onRetry={() => void runCheck()} />;

  const clinic = visit?.clinic;
  const canStart = eligibility?.can_start === true;
  const offerException = eligibility
    ? canRequestException({ blockingReason: eligibility.blocking_reason } as never)
    : false;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.clinicName}>{clinic?.name ?? '—'}</Text>
        <Text style={styles.muted}>{clinic?.address ?? ''}</Text>
        <Text style={styles.doctors}>
          {visit?.planned_visit_doctor.map((d) => d.doctor?.full_name).filter(Boolean).join(', ') || '—'}
        </Text>
      </Card>

      {/* The headline verdict, big enough to read at arm's length. */}
      <View style={[styles.verdict, canStart ? styles.verdictOk : styles.verdictBlocked]}>
        <Text style={styles.verdictEmoji}>{checking ? '⏳' : canStart ? '✅' : '⛔'}</Text>
        <Text style={[styles.verdictText, canStart ? styles.verdictTextOk : styles.verdictTextBlocked]}>
          {checking
            ? mn.startVisit.checking
            : canStart
              ? mn.startVisit.ready
              : mn.startVisit.notReady}
        </Text>
        {!checking && !canStart && eligibility?.blocking_reason ? (
          <Text style={styles.verdictReason}>{reasonText(eligibility.blocking_reason)}</Text>
        ) : null}
      </View>

      {/* The numbers that let someone decide what to do next. */}
      <Card>
        <Measure
          label={mn.startVisit.distanceLabel}
          value={
            eligibility?.distance_m != null
              ? formatDistanceMn(Number(eligibility.distance_m))
              : '—'
          }
          ok={eligibility?.within_radius}
        />
        <Measure
          label={mn.startVisit.radiusLabel}
          value={eligibility?.radius_m != null ? `${eligibility.radius_m} м` : '—'}
        />
        <Measure
          label={mn.startVisit.accuracyLabel}
          value={reading?.accuracyM != null ? `± ${Math.round(reading.accuracyM)} м` : '—'}
          ok={eligibility?.accuracy_ok}
        />
        <Measure
          label={mn.startVisit.accuracyThresholdLabel}
          value={eligibility ? `${eligibility.accuracy_threshold_m} м` : '—'}
        />
      </Card>

      {/* Every condition, ticked or crossed. */}
      <Card>
        <Condition label={mn.startVisit.condOwner}    ok={eligibility?.is_owner} />
        <Condition label={mn.startVisit.condToday}    ok={eligibility?.is_today} />
        <Condition label={mn.startVisit.condStatus}   ok={eligibility?.is_status_planned} />
        <Condition label={mn.startVisit.condNoOther}  ok={eligibility?.no_other_in_progress} />
        <Condition label={mn.startVisit.condLocation} ok={eligibility?.has_location} />
        <Condition label={mn.startVisit.condAccuracy} ok={eligibility?.accuracy_ok} />
        <Condition label={mn.startVisit.condRadius}   ok={eligibility?.within_radius} />
      </Card>

      {locationError ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>{locationError}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label={starting ? mn.startVisit.starting : mn.startVisit.confirmAndStart}
        onPress={() => void handleStart()}
        disabled={!canStart || checking}
        busy={starting}
      />

      <SecondaryButton
        label={checking ? mn.startVisit.checking : mn.startVisit.recheck}
        onPress={() => void runCheck()}
        disabled={checking || starting}
      />

      {offerException ? (
        <View style={styles.exceptionBox}>
          <Text style={styles.exceptionText}>{mn.startVisit.exceptionHint}</Text>
          <SecondaryButton
            label={mn.today.exception}
            onPress={() => router.push(`/visit/${id}/exception`)}
          />
        </View>
      ) : null}

      <Text style={styles.notice}>{mn.startVisit.locationNotice}</Text>
    </ScrollView>
  );
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'not_owner':               return mn.startVisit.reasonNotOwner;
    case 'not_today':               return mn.startVisit.reasonNotToday;
    case 'wrong_status':            return mn.startVisit.reasonWrongStatus;
    case 'other_visit_in_progress': return mn.startVisit.reasonOtherInProgress;
    case 'no_location':             return mn.startVisit.reasonNoLocation;
    case 'poor_accuracy':           return mn.startVisit.reasonPoorAccuracy;
    case 'outside_radius':          return mn.startVisit.reasonOutsideRadius;
    default:                        return mn.startVisit.notReady;
  }
}

function Measure({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={styles.measureRow}>
      <Text style={styles.measureLabel}>{label}</Text>
      <Text
        style={[
          styles.measureValue,
          ok === true && styles.measureOk,
          ok === false && styles.measureBad,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Condition({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <View style={styles.conditionRow}>
      <Text style={styles.conditionMark}>{ok === true ? '✅' : ok === false ? '❌' : '⏳'}</Text>
      <Text style={[styles.conditionLabel, ok === false && styles.conditionFailed]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 },

  clinicName: { ...typography.title, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  doctors: { ...typography.body, color: colors.primary, fontWeight: '600' },

  verdict: { borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  verdictOk: { backgroundColor: colors.successBg, borderWidth: 2, borderColor: colors.success },
  verdictBlocked: { backgroundColor: colors.dangerBg, borderWidth: 2, borderColor: colors.danger },
  verdictEmoji: { fontSize: 40 },
  verdictText: { ...typography.title, textAlign: 'center' },
  verdictTextOk: { color: colors.success },
  verdictTextBlocked: { color: colors.danger },
  verdictReason: { ...typography.body, color: colors.danger, textAlign: 'center', lineHeight: 22 },

  measureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  measureLabel: { ...typography.body, color: colors.textMuted, flex: 1 },
  measureValue: { ...typography.bodyStrong, color: colors.text },
  measureOk: { color: colors.success },
  measureBad: { color: colors.danger },

  conditionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 34 },
  conditionMark: { fontSize: 17, width: 24 },
  conditionLabel: { ...typography.body, color: colors.text, flex: 1 },
  conditionFailed: { color: colors.danger, fontWeight: '600' },

  warning: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warningText: { ...typography.body, color: colors.warning, lineHeight: 21 },

  exceptionBox: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  exceptionText: { ...typography.body, color: colors.info, lineHeight: 21 },

  notice: { ...typography.caption, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
