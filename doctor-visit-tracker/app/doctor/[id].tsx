/**
 * Screen 14 — Эмчийн профайл ба уулзалтын түүх (Doctor profile and visit history)
 *
 * PHASE 1 SCOPE
 * -------------
 * The profile and the clinic list are real and working. The visit history and
 * its five filters need the visit tables from Phases 3 and 4, so that section
 * is explicitly labelled as not yet implemented rather than shown as an empty
 * list — an empty list would wrongly suggest "this doctor has never been
 * visited".
 */
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchClinicsForDoctor, fetchDoctor } from '../../src/data/repositories';
import {
  Card,
  ErrorState,
  Field,
  LoadingState,
  NotImplemented,
  Pill,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { weekdayMn } from '../../src/lib/i18n/enums';
import { colors, radius, spacing, typography } from '../../src/theme';

export default function DoctorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const loader = useCallback(async () => {
    if (!id) return { data: null, error: mn.errors.loadFailed };

    const [doctor, clinics] = await Promise.all([fetchDoctor(id), fetchClinicsForDoctor(id)]);
    if (doctor.error) return { data: null, error: doctor.error };
    if (!doctor.data) return { data: null, error: mn.common.empty };

    return { data: { doctor: doctor.data, clinics: clinics.data ?? [] }, error: null };
  }, [id]);

  const { data, loading, error, reload } = useAsyncData(loader, [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? mn.common.empty} onRetry={reload} />;

  const { doctor, clinics } = data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {doctor.full_name.trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name}>{doctor.full_name}</Text>
            <Text style={styles.speciality}>{doctor.speciality}</Text>
          </View>
        </View>

        <View style={styles.pillRow}>
          <Pill
            label={doctor.is_active ? mn.common.active : mn.common.inactive}
            tone={doctor.is_active ? 'success' : 'warning'}
          />
        </View>

        <Field label={mn.doctors.phone} value={doctor.phone ?? '—'} />
        <Field label={mn.doctors.email} value={doctor.email ?? '—'} />
      </Card>

      {doctor.professional_notes ? (
        <Section title={mn.doctors.professionalNotes}>
          <Card>
            <Text style={styles.notes}>{doctor.professional_notes}</Text>
            {/*
              Displayed on every doctor screen. The schema has no patient
              columns at all, but the reminder is what keeps free text clean.
            */}
            <Text style={styles.warning}>{mn.doctors.noPatientInfo}</Text>
          </Card>
        </Section>
      ) : null}

      <Section title={`${mn.doctors.worksAt} (${clinics.length})`}>
        {clinics.length === 0 ? (
          <Card>
            <Text style={styles.muted}>{mn.clinics.empty}</Text>
          </Card>
        ) : (
          clinics.map((link) => {
            const clinic = link.clinic;
            if (!clinic) return null;
            return (
              <Pressable
                key={link.id}
                onPress={() => router.push(`/clinic/${clinic.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.clinicRow, pressed && styles.pressed]}
              >
                <View style={styles.clinicMain}>
                  <Text style={styles.clinicName}>{clinic.name}</Text>
                  <Text style={styles.clinicMeta}>
                    {clinic.district} · {clinic.address}
                  </Text>
                  <Text style={styles.clinicMeta}>
                    {[link.department, link.room_or_floor].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  <Text style={styles.clinicMeta}>
                    {link.available_days
                      .map((day) => weekdayMn[day as keyof typeof weekdayMn] ?? day)
                      .join(', ')}
                    {link.available_hours ? ` · ${link.available_hours}` : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })
        )}
      </Section>

      <Section title={mn.doctors.visitHistory}>
        <NotImplemented
          what={mn.doctors.visitHistory}
          hint="Бүх төлөөлөгчийн илгээсэн уулзалтын түүх, 5 шүүлтүүрийн хамт 4-р шатанд нэмэгдэнэ."
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.display, color: colors.primaryDark, fontSize: 24 },
  headerText: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.text },
  speciality: { ...typography.body, color: colors.primary, fontWeight: '600' },

  pillRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  notes: { ...typography.body, color: colors.text, lineHeight: 23 },
  warning: { ...typography.caption, color: colors.warning, fontWeight: '600' },
  muted: { ...typography.body, color: colors.textMuted },

  clinicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 76,
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  clinicMain: { flex: 1, gap: 2 },
  clinicName: { ...typography.bodyStrong, color: colors.text },
  clinicMeta: { ...typography.caption, color: colors.textMuted },
  chevron: { fontSize: 26, color: colors.textFaint },
});
