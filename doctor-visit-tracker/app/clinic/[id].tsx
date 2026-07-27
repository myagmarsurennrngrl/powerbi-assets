/**
 * Screen 12 — Эмнэлгийн дэлгэрэнгүй (Clinic detail)
 *
 * "Open in map" hands off to the phone's own map app. That is a real, working
 * feature with no API key and no extra dependency — and it is what a
 * representative in a car actually wants.
 */
import React, { useCallback } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchClinic, fetchDoctorsAtClinic } from '../../src/data/repositories';
import {
  Card,
  ErrorState,
  Field,
  LoadingState,
  NotImplemented,
  Pill,
  PrimaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { weekdayMn } from '../../src/lib/i18n/enums';
import { colors, radius, spacing, typography } from '../../src/theme';

export default function ClinicDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const loader = useCallback(async () => {
    if (!id) return { data: null, error: mn.errors.loadFailed };

    const [clinic, doctors] = await Promise.all([fetchClinic(id), fetchDoctorsAtClinic(id)]);
    if (clinic.error) return { data: null, error: clinic.error };
    if (!clinic.data) return { data: null, error: mn.common.empty };

    return { data: { clinic: clinic.data, doctors: doctors.data ?? [] }, error: null };
  }, [id]);

  const { data, loading, error, reload } = useAsyncData(loader, [id]);

  const openInMap = () => {
    if (!data) return;
    const { latitude, longitude, name } = data.clinic;
    const label = encodeURIComponent(name);

    // Platform-native map URLs, so the phone opens Apple Maps or Google Maps
    // rather than a browser.
    const url = Platform.select({
      ios: `maps://?q=${label}&ll=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    });

    Linking.openURL(url).catch(() => {
      Alert.alert(mn.common.error, mn.errors.loadFailed);
    });
  };

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? mn.common.empty} onRetry={reload} />;

  const { clinic, doctors } = data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.name}>{clinic.name}</Text>
        <View style={styles.pillRow}>
          <Pill label={clinic.district} tone="info" />
          <Pill
            label={clinic.is_active ? mn.common.active : mn.common.inactive}
            tone={clinic.is_active ? 'success' : 'warning'}
          />
        </View>
        <Field label={mn.clinics.type} value={clinic.clinic_type} />
        <Field label={mn.clinics.address} value={clinic.address} />
        <Field label={mn.clinics.phone} value={clinic.contact_phone ?? '—'} />
        {clinic.notes ? <Field label={mn.clinics.notes} value={clinic.notes} /> : null}
      </Card>

      <Card>
        <Field
          label={mn.clinics.coordinates}
          value={`${Number(clinic.latitude).toFixed(6)}, ${Number(clinic.longitude).toFixed(6)}`}
        />
        <Field label={mn.clinics.radius} value={`${clinic.geofence_radius_m} м`} />
        <Text style={styles.radiusHint}>
          {mn.clinics.radiusExplain(clinic.geofence_radius_m)}
        </Text>
        <PrimaryButton label={mn.clinics.openInMap} onPress={openInMap} />
      </Card>

      <Section title={`${mn.clinics.doctorsHere} (${doctors.length})`}>
        {doctors.length === 0 ? (
          <Card>
            <Text style={styles.muted}>{mn.doctors.empty}</Text>
          </Card>
        ) : (
          doctors.map((link) => {
            const doctor = link.doctor;
            if (!doctor) return null;
            return (
              <Pressable
                key={link.id}
                onPress={() => router.push(`/doctor/${doctor.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.doctorRow, pressed && styles.pressed]}
              >
                <View style={styles.doctorMain}>
                  <Text style={styles.doctorName}>{doctor.full_name}</Text>
                  <Text style={styles.doctorSpeciality}>{doctor.speciality}</Text>
                  <Text style={styles.doctorMeta}>
                    {[link.department, link.room_or_floor].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  <Text style={styles.doctorMeta}>
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
          what="Энэ эмнэлэг дэх уулзалтын түүх"
          hint="Уулзалтын бүртгэл 3-4-р шатанд нэмэгдэнэ."
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  name: { ...typography.title, color: colors.text },
  pillRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  radiusHint: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  muted: { ...typography.body, color: colors.textMuted },

  doctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 72,
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  doctorMain: { flex: 1, gap: 2 },
  doctorName: { ...typography.bodyStrong, color: colors.text },
  doctorSpeciality: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  doctorMeta: { ...typography.caption, color: colors.textMuted },
  chevron: { fontSize: 26, color: colors.textFaint },
});
