/**
 * Screen 3 — Өнөөдрийн маршрут (Today's route)
 *
 * The screen a representative actually lives in.
 *
 * LOCATION BEHAVIOUR — read this before changing anything here.
 * Distances are NOT shown automatically. The representative taps «Зайг харах»,
 * the app takes ONE position reading, computes distances locally, and stops.
 * There is no watcher and no polling. If they never tap, the app never learns
 * where they are. This is the visible half of the promise made in Settings.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { fetchRoute, type RouteStop } from '../../src/data/planning';
import { readCurrentPosition, type LocationFailure } from '../../src/lib/location';
import { formatDistanceMn, haversineMetres } from '../../src/domain/geo';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { visitStatusMn } from '../../src/lib/i18n/enums';
import { formatDateLongMn } from '../../src/lib/datetime';
import { colors, radius, spacing, typography } from '../../src/theme';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  planned: 'info',
  in_progress: 'warning',
  completed: 'success',
  missed: 'danger',
  rescheduled: 'neutral',
  cancellation_requested: 'warning',
  cancelled_approved: 'neutral',
  cancelled_unapproved: 'danger',
};

export default function TodayScreen() {
  const router = useRouter();

  const [stops, setStops] = useState<RouteStop[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);

    const result = await fetchRoute();
    setStops(result.data);
    setError(result.error);

    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever the tab regains focus — a plan may have changed elsewhere.
  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const locationFailureMessage = (failure: LocationFailure): string => {
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

  const updateDistances = useCallback(async () => {
    setLocating(true);
    const result = await readCurrentPosition('balanced');
    setLocating(false);

    if (!result.ok) {
      Alert.alert(mn.today.distance, locationFailureMessage(result.failure));
      return;
    }
    setOrigin({
      latitude: result.reading.latitude,
      longitude: result.reading.longitude,
    });
  }, []);

  const openInMap = (stop: RouteStop) => {
    const label = encodeURIComponent(stop.clinic_name);
    const url = Platform.select({
      ios: `maps://?q=${label}&ll=${stop.latitude},${stop.longitude}`,
      android: `geo:${stop.latitude},${stop.longitude}?q=${stop.latitude},${stop.longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${stop.latitude},${stop.longitude}`,
    });
    Linking.openURL(url).catch(() => Alert.alert(mn.common.error, mn.errors.loadFailed));
  };

  const completedCount = useMemo(
    () => (stops ?? []).filter((s) => s.status === 'completed').length,
    [stops],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load('initial')} />;

  return (
    <FlatList
      style={styles.screen}
      data={stops ?? []}
      keyExtractor={(item) => item.planned_visit_id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.date}>{formatDateLongMn(new Date())}</Text>
          <Text style={styles.summary}>
            {mn.today.summary(completedCount, stops?.length ?? 0)}
          </Text>

          {stops && stops.length > 0 ? (
            <View style={styles.locationBox}>
              <Text style={styles.locationTitle}>{mn.today.locationWhyTitle}</Text>
              <Text style={styles.locationBody}>{mn.today.locationWhy}</Text>
              <SecondaryButton
                label={
                  locating
                    ? mn.today.locating
                    : origin
                      ? mn.today.refreshDistance
                      : mn.today.showDistance
                }
                onPress={() => void updateDistances()}
                disabled={locating}
              />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState label={`${mn.today.noVisits}\n${mn.today.noVisitsHint}`} />
      }
      // An unplanned visit is always available, including on a day with no
      // route at all — that is precisely when one is most likely to happen.
      ListFooterComponent={
        <View style={styles.footer}>
          <SecondaryButton
            label={mn.unplanned.start}
            onPress={() => router.push('/visit/unplanned')}
          />
        </View>
      }
      renderItem={({ item }) => (
        <RouteCard
          stop={item}
          origin={origin}
          onOpenMap={() => openInMap(item)}
          onOpenDetail={() => router.push(`/visit/${item.planned_visit_id}`)}
          onStart={() => router.push(`/visit/${item.planned_visit_id}/start`)}
          onOpenActive={() => router.push(`/visit/${item.planned_visit_id}/active`)}
          onException={() => router.push(`/visit/${item.planned_visit_id}/exception`)}
        />
      )}
    />
  );
}

function RouteCard({
  stop,
  origin,
  onOpenMap,
  onOpenDetail,
  onStart,
  onOpenActive,
  onException,
}: {
  stop: RouteStop;
  origin: { latitude: number; longitude: number } | null;
  onOpenMap: () => void;
  onOpenDetail: () => void;
  onStart: () => void;
  onOpenActive: () => void;
  onException: () => void;
}) {
  const distance = origin
    ? haversineMetres(origin, { latitude: Number(stop.latitude), longitude: Number(stop.longitude) })
    : null;

  const withinRadius = distance !== null && distance <= stop.geofence_radius_m;

  return (
    <Pressable
      onPress={onOpenDetail}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.orderBadge}>
          <Text style={styles.orderBadgeText}>{stop.planned_order}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.clinicName} numberOfLines={2}>
            {stop.clinic_name}
          </Text>
          <Text style={styles.address} numberOfLines={2}>
            {stop.clinic_district} · {stop.clinic_address}
          </Text>
        </View>
        <Pill
          label={visitStatusMn[stop.status] ?? stop.status}
          tone={STATUS_TONE[stop.status] ?? 'neutral'}
        />
      </View>

      <View style={styles.metaRow}>
        {stop.planned_time ? (
          <Text style={styles.meta}>{mn.today.plannedAt(stop.planned_time.slice(0, 5))}</Text>
        ) : null}
        {distance !== null ? (
          <Text style={[styles.distance, withinRadius ? styles.distanceNear : null]}>
            {formatDistanceMn(distance)}
            {withinRadius ? ' · эмнэлгийн ойролцоо' : ''}
          </Text>
        ) : null}
      </View>

      <Text style={styles.label}>{mn.visitDetail.doctors}</Text>
      <Text style={styles.value}>{stop.doctor_names.join(', ') || '—'}</Text>

      <View style={styles.chipRow}>
        {stop.brand_names.map((brand) => (
          <View key={brand} style={styles.chip}>
            <Text style={styles.chipText}>{brand}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <View style={styles.actionHalf}>
          <SecondaryButton label={mn.today.openInMap} onPress={onOpenMap} />
        </View>
        <View style={styles.actionHalf}>
          <SecondaryButton label={mn.visitDetail.title} onPress={onOpenDetail} />
        </View>
      </View>

      {/*
        Only offered for a visit that has not started yet. The button opens the
        confirmation screen, which is where the eight conditions are checked —
        it never starts a visit directly, because a representative should always
        see the distance and accuracy before committing.
      */}
      {stop.status === 'planned' ? (
        <>
          <PrimaryButton label={mn.today.startVisit} onPress={onStart} />
          <SecondaryButton label={mn.today.exception} onPress={onException} />
        </>
      ) : null}
      {stop.status === 'in_progress' ? (
        <PrimaryButton label={mn.activeVisit.openActive} onPress={onOpenActive} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  header: { gap: spacing.sm, marginBottom: spacing.xs },
  footer: { marginTop: spacing.md },
  date: { ...typography.heading, color: colors.text },
  summary: { ...typography.body, color: colors.textMuted },

  locationBox: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  locationTitle: { ...typography.label, color: colors.info },
  locationBody: { ...typography.caption, color: colors.info, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  orderBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: { ...typography.bodyStrong, color: colors.onPrimary },
  cardHeaderText: { flex: 1, gap: 2 },
  clinicName: { ...typography.heading, color: colors.text },
  address: { ...typography.caption, color: colors.textMuted },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' },
  meta: { ...typography.caption, color: colors.textMuted },
  distance: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  distanceNear: { color: colors.success },

  label: { ...typography.label, color: colors.textMuted },
  value: { ...typography.body, color: colors.text },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  chipText: { ...typography.caption, color: colors.primaryDark, fontWeight: '600' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionHalf: { flex: 1 },

});
