/**
 * Screen 6 — Уулзалтын дэлгэрэнгүй (Visit detail)
 *
 * Everything about one planned visit, plus its status trail. The start-visit
 * flow lands here in Phase 3; until then the screen says so rather than
 * showing a button that cannot work.
 */
import React, { useCallback } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchPlannedVisit } from '../../src/data/planning';
import { getSupabase } from '../../src/lib/supabase';
import {
  Card,
  ErrorState,
  Field,
  LoadingState,
  NotImplemented,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { visitStatusMn } from '../../src/lib/i18n/enums';
import { formatDateLongMn, formatDateTimeMn } from '../../src/lib/datetime';
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

interface StatusEntry {
  id: number;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  note: string | null;
}

export default function VisitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const loader = useCallback(async () => {
    if (!id) return { data: null, error: mn.errors.loadFailed };

    const visit = await fetchPlannedVisit(id);
    if (visit.error) return { data: null, error: visit.error };
    if (!visit.data) return { data: null, error: mn.common.empty };

    const supabase = getSupabase();
    const { data: history } = supabase
      ? await supabase
          .from('visit_status_history')
          .select('id, from_status, to_status, changed_at, note')
          .eq('planned_visit_id', id)
          .order('changed_at', { ascending: true })
      : { data: [] };

    return { data: { visit: visit.data, history: (history ?? []) as StatusEntry[] }, error: null };
  }, [id]);

  const { data, loading, error, reload } = useAsyncData(loader, [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? mn.common.empty} onRetry={reload} />;

  const { visit, history } = data;
  const clinic = visit.clinic;

  const openInMap = () => {
    if (!clinic) return;
    const label = encodeURIComponent(clinic.name);
    const url = Platform.select({
      ios: `maps://?q=${label}&ll=${clinic.latitude},${clinic.longitude}`,
      android: `geo:${clinic.latitude},${clinic.longitude}?q=${clinic.latitude},${clinic.longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${clinic.latitude},${clinic.longitude}`,
    });
    Linking.openURL(url).catch(() => Alert.alert(mn.common.error, mn.errors.loadFailed));
  };

  const doctors = visit.planned_visit_doctor.map((d) => d.doctor).filter(Boolean);
  const brands = [...new Set(visit.planned_visit_brand.map((b) => b.brand?.name).filter(Boolean))];
  const products = [
    ...new Set(visit.planned_visit_brand.map((b) => b.product?.name).filter(Boolean)),
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.clinicName}>{clinic?.name ?? '—'}</Text>
            <Text style={styles.date}>{formatDateLongMn(visit.planned_date)}</Text>
          </View>
          <Pill
            label={visitStatusMn[visit.status] ?? visit.status}
            tone={STATUS_TONE[visit.status] ?? 'neutral'}
          />
        </View>

        <Field label={mn.visitDetail.order} value={`${visit.planned_order}`} />
        <Field
          label={mn.visitDetail.plannedFor}
          value={visit.planned_time ? visit.planned_time.slice(0, 5) : '—'}
        />
        <Field label={mn.visitDetail.objective} value={visit.objective} />
      </Card>

      {clinic ? (
        <Card>
          <Text style={styles.sectionHeading}>{mn.visitDetail.clinic}</Text>
          <Field label={mn.clinics.address} value={`${clinic.district} · ${clinic.address}`} />
          <Field label={mn.clinics.phone} value={clinic.contact_phone ?? '—'} />
          <Field label={mn.clinics.radius} value={`${clinic.geofence_radius_m} м`} />
          <SecondaryButton label={mn.today.openInMap} onPress={openInMap} />
          <SecondaryButton
            label={mn.clinics.title}
            onPress={() => router.push(`/clinic/${clinic.id}`)}
          />
        </Card>
      ) : null}

      <Section title={mn.visitDetail.doctors}>
        {doctors.length === 0 ? (
          <Card>
            <Text style={styles.muted}>—</Text>
          </Card>
        ) : (
          doctors.map((doctor) =>
            doctor ? (
              <Card key={doctor.id}>
                <Text style={styles.doctorName}>{doctor.full_name}</Text>
                <Text style={styles.muted}>{doctor.speciality}</Text>
                <SecondaryButton
                  label={mn.doctors.title}
                  onPress={() => router.push(`/doctor/${doctor.id}`)}
                />
              </Card>
            ) : null,
          )
        )}
      </Section>

      <Card>
        <Text style={styles.sectionHeading}>{mn.visitDetail.brands}</Text>
        <Text style={styles.value}>{brands.join(', ') || '—'}</Text>
        {products.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>{mn.visitDetail.products}</Text>
            <Text style={styles.value}>{products.join(', ')}</Text>
          </>
        ) : null}
      </Card>

      <Section title={mn.visitDetail.statusHistory}>
        <Card>
          {history.length === 0 ? (
            <Text style={styles.muted}>{mn.common.empty}</Text>
          ) : (
            history.map((entry) => (
              <View key={entry.id} style={styles.historyRow}>
                <Text style={styles.historyTime}>{formatDateTimeMn(entry.changed_at)}</Text>
                <Text style={styles.historyText}>
                  {entry.from_status
                    ? `${visitStatusMn[entry.from_status as keyof typeof visitStatusMn] ?? entry.from_status} → `
                    : ''}
                  {visitStatusMn[entry.to_status as keyof typeof visitStatusMn] ?? entry.to_status}
                </Text>
              </View>
            ))
          )}
        </Card>
      </Section>

      <NotImplemented
        what={`${mn.today.startVisit} / ${mn.today.exception}`}
        hint="Байршил шалгах, уулзалт эхлүүлэх, дуусгах, чөлөөлөх хүсэлт — 3-5-р шатанд нэмэгдэнэ."
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  clinicName: { ...typography.title, color: colors.text },
  date: { ...typography.body, color: colors.textMuted },

  sectionHeading: { ...typography.label, color: colors.textMuted },
  value: { ...typography.body, color: colors.text },
  muted: { ...typography.body, color: colors.textMuted },
  doctorName: { ...typography.bodyStrong, color: colors.text },

  historyRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyTime: { ...typography.caption, color: colors.textMuted, width: 120 },
  historyText: { ...typography.caption, color: colors.text, flex: 1 },
});
