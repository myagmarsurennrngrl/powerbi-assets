/**
 * Screen 24 — Төлөвлөгөөнд байхгүй уулзалт (Start an unplanned visit)
 *
 * A representative who is at a clinic anyway and gets ten minutes with a doctor
 * needs a way to record it. Without one they either record nothing, or invent a
 * planned visit afterwards — and both are worse than the truth.
 *
 * Three things this screen is deliberate about:
 *
 *  1. **The geofence is not relaxed.** The same distance and accuracy rules
 *     apply, computed by the server. "Unplanned" changes what was scheduled,
 *     not where the person is standing.
 *  2. **The KPI consequence is stated up front**, not discovered later: an
 *     unplanned visit is counted separately and never improves the completion
 *     percentage. Otherwise this screen would look like a shortcut.
 *  3. **If today's plan already includes this clinic, it says so loudly** and
 *     offers the route instead. Starting an unplanned visit here would leave
 *     the planned one looking missed.
 *
 * Location is read once per check, on demand. There is no watcher.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { useSession } from '../../src/lib/auth';
import { useSync } from '../../src/lib/offline/SyncProvider';
import {
  checkUnplannedEligibility,
  fetchNearbyClinics,
  startUnplannedVisit,
  type NearbyClinic,
  type UnplannedEligibility,
} from '../../src/data/visits';
import {
  readCurrentPosition,
  type LocationFailure,
  type LocationReading,
} from '../../src/lib/location';
import { formatDistanceMn } from '../../src/domain/geo';
import {
  Card,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../../src/theme';

function locationMessage(failure: LocationFailure): string {
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
}

export default function UnplannedVisitScreen() {
  const router = useRouter();
  const { isRep } = useSession();
  const { online } = useSync();

  const [reading, setReading] = useState<LocationReading | null>(null);
  const [clinics, setClinics] = useState<NearbyClinic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<UnplannedEligibility | null>(null);
  const [reason, setReason] = useState('');

  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  /** One UUID per mount, so a retry cannot create a second visit. */
  const clientUuid = useRef<string>(Crypto.randomUUID());
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  /** Take a single high-accuracy fix and list the clinics around it. */
  const locate = useCallback(async () => {
    setChecking(true);
    setLocationError(null);

    const result = await readCurrentPosition('high');
    if (!result.ok) {
      setReading(null);
      setClinics([]);
      setLocationError(locationMessage(result.failure));
      setChecking(false);
      setLoading(false);
      return;
    }

    setReading(result.reading);

    const nearby = await fetchNearbyClinics({
      latitude: result.reading.latitude,
      longitude: result.reading.longitude,
    });

    if (nearby.error) setError(nearby.error);
    const rows = nearby.data ?? [];
    setClinics(rows);

    // Preselect the clinic the representative is actually inside, if any —
    // usually there is exactly one and this saves a tap in a corridor.
    const inside = rows.find((c) => c.within_radius);
    if (inside) setSelected(inside.clinic_id);

    setChecking(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  // Ask the server for its verdict whenever the chosen clinic or the fix
  // changes. The server's answer is the one that decides.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selected || !reading) {
        setEligibility(null);
        return;
      }
      const result = await checkUnplannedEligibility(selected, {
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracyM: reading.accuracyM,
      });
      if (cancelled) return;
      if (result.error) setError(result.error);
      setEligibility(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, reading]);

  if (!isRep) return <EmptyState label={mn.errors.noPermission} />;
  if (loading) return <LoadingState />;

  const canStart = eligibility?.can_start === true && reason.trim().length > 0;

  async function handleStart() {
    if (!selected || !reading || starting) return;

    setStarting(true);
    const result = await startUnplannedVisit({
      clinicId: selected,
      reason: reason.trim(),
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
      // The server message carries the numbers ("you are 240 m away").
      Alert.alert(mn.unplanned.title, result.error ?? mn.common.error);
      await locate();
      return;
    }

    router.replace(`/visit/${result.data.id}/active`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.intro}>{mn.unplanned.intro}</Text>
        <View style={styles.kpiNote}>
          <Text style={styles.kpiNoteText}>{mn.unplanned.kpiNote}</Text>
        </View>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {!online ? (
        <Card style={styles.connectionNotice}>
          <Text style={styles.connectionNoticeTitle}>{mn.sync.needsConnection}</Text>
          <Text style={styles.connectionNoticeText}>{mn.sync.needsConnectionWhy}</Text>
        </Card>
      ) : null}

      {locationError ? (
        <Card>
          <Text style={styles.locationError}>{locationError}</Text>
          <SecondaryButton label={mn.unplanned.refresh} onPress={() => void locate()} />
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>{mn.unplanned.chooseClinic}</Text>

      {checking ? (
        <LoadingState label={mn.unplanned.searching} />
      ) : clinics.length === 0 ? (
        <EmptyState label={mn.unplanned.noClinicsNearby} />
      ) : (
        clinics.map((clinic) => (
          <Pressable
            key={clinic.clinic_id}
            onPress={() => setSelected(clinic.clinic_id)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === clinic.clinic_id }}
          >
            <Card style={selected === clinic.clinic_id ? styles.selectedCard : undefined}>
              <View style={styles.clinicHeader}>
                <Text style={styles.clinicName}>{clinic.clinic_name}</Text>
                <Pill
                  label={clinic.within_radius ? mn.unplanned.withinRadius : mn.unplanned.tooFar}
                  tone={clinic.within_radius ? 'success' : 'neutral'}
                />
              </View>
              <Text style={styles.clinicMeta}>
                {clinic.district} · {formatDistanceMn(Number(clinic.distance_m))}
              </Text>
            </Card>
          </Pressable>
        ))
      )}

      {eligibility?.already_planned_here ? (
        <Card style={styles.warnCard}>
          <Text style={styles.warnText}>{mn.unplanned.alreadyPlannedWarning}</Text>
          <SecondaryButton
            label={mn.unplanned.goToPlanned}
            onPress={() => router.replace('/(tabs)/today')}
          />
        </Card>
      ) : null}

      {selected ? (
        <Card>
          <LabelledInput
            label={mn.unplanned.reason}
            hint={mn.unplanned.reasonHint}
            placeholder={mn.unplanned.reasonPlaceholder}
            value={reason}
            onChangeText={setReason}
            multiline
          />

          {eligibility && !eligibility.can_start ? (
            <View style={styles.blockBox}>
              <Text style={styles.blockText}>{blockingText(eligibility)}</Text>
            </View>
          ) : null}

          {eligibility?.distance_m !== null && eligibility?.distance_m !== undefined ? (
            <Text style={styles.distance}>
              {formatDistanceMn(Number(eligibility.distance_m))} / {eligibility.radius_m} м
            </Text>
          ) : null}
        </Card>
      ) : null}

      <PrimaryButton
        label={starting ? mn.unplanned.starting : mn.unplanned.start}
        onPress={() => void handleStart()}
        disabled={!canStart || starting}
        busy={starting}
      />

      <SecondaryButton label={mn.unplanned.refresh} onPress={() => void locate()} />

      <Text style={styles.notice}>{mn.startVisit.locationNotice}</Text>
    </ScrollView>
  );
}

/** The single most useful reason, in the representative's language. */
function blockingText(e: UnplannedEligibility): string {
  switch (e.blocking_reason) {
    case 'not_found':
      return mn.common.empty;
    case 'not_representative':
      return mn.errors.noPermission;
    case 'clinic_inactive':
      return mn.common.inactive;
    case 'other_visit_in_progress':
      return mn.startVisit.reasonOtherInProgress;
    case 'no_location':
      return mn.startVisit.reasonNoLocation;
    case 'poor_accuracy':
      return mn.startVisit.reasonPoorAccuracy;
    case 'outside_radius':
      return mn.startVisit.reasonOutsideRadius;
    default:
      return mn.common.error;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  intro: { ...typography.body, color: colors.text, lineHeight: 21 },
  connectionNotice: { borderColor: colors.warning, borderWidth: 1 },
  connectionNoticeTitle: { ...typography.bodyStrong, color: colors.warning },
  connectionNoticeText: { ...typography.caption, color: colors.warning, lineHeight: 18 },
  kpiNote: { backgroundColor: colors.infoBg, borderRadius: radius.md, padding: spacing.md },
  kpiNoteText: { ...typography.caption, color: colors.info, lineHeight: 18 },

  sectionTitle: { ...typography.bodyStrong, color: colors.text },

  selectedCard: { borderColor: colors.primary, borderWidth: 2 },
  clinicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  clinicName: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  clinicMeta: { ...typography.caption, color: colors.textMuted },

  warnCard: { borderColor: colors.warning, borderWidth: 1 },
  warnText: { ...typography.caption, color: colors.warning, lineHeight: 18 },

  blockBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md },
  blockText: { ...typography.caption, color: colors.danger, lineHeight: 18 },
  distance: { ...typography.caption, color: colors.textMuted },

  locationError: { ...typography.body, color: colors.danger },
  notice: { ...typography.caption, color: colors.textFaint, lineHeight: 18 },
});
