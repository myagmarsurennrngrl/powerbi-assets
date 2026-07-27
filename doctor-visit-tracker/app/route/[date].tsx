/**
 * The route for any single day, reached by tapping a day in the weekly
 * calendar. Read-only: today's route (with distances and, from Phase 3, the
 * start button) is the tab screen.
 */
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchRoute } from '../../src/data/planning';
import { Card, EmptyState, ErrorState, LoadingState, Pill } from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { visitStatusMn } from '../../src/lib/i18n/enums';
import { formatDateLongMn, todayLocal } from '../../src/lib/datetime';
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

export default function RouteForDateScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();

  const loader = useCallback(async () => {
    if (!date) return { data: null, error: mn.errors.loadFailed };
    return fetchRoute(date);
  }, [date]);

  const { data, loading, error, reload } = useAsyncData(loader, [date]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const isToday = date === todayLocal();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.date}>{date ? formatDateLongMn(date) : '—'}</Text>
        {isToday ? <Pill label={mn.today.title} tone="success" /> : null}
      </View>

      {!data || data.length === 0 ? (
        <EmptyState label={mn.week.noVisitsOnDay} />
      ) : (
        data.map((stop) => (
          <Pressable
            key={stop.planned_visit_id}
            onPress={() => router.push(`/visit/${stop.planned_visit_id}`)}
            accessibilityRole="button"
          >
            <Card>
              <View style={styles.cardHeader}>
                <View style={styles.orderBadge}>
                  <Text style={styles.orderBadgeText}>{stop.planned_order}</Text>
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.clinicName}>{stop.clinic_name}</Text>
                  <Text style={styles.muted}>
                    {stop.planned_time ? `${stop.planned_time.slice(0, 5)} · ` : ''}
                    {stop.clinic_district}
                  </Text>
                </View>
                <Pill
                  label={visitStatusMn[stop.status] ?? stop.status}
                  tone={STATUS_TONE[stop.status] ?? 'neutral'}
                />
              </View>

              <Text style={styles.label}>{mn.visitDetail.doctors}</Text>
              <Text style={styles.value}>{stop.doctor_names.join(', ') || '—'}</Text>

              <Text style={styles.label}>{mn.visitDetail.brands}</Text>
              <Text style={styles.value}>{stop.brand_names.join(', ') || '—'}</Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  date: { ...typography.heading, color: colors.text },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  orderBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: { ...typography.bodyStrong, color: colors.onPrimary },
  cardHeaderText: { flex: 1, gap: 2 },
  clinicName: { ...typography.bodyStrong, color: colors.text },

  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },
  value: { ...typography.body, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
});
