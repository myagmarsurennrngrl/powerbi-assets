import React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchClinics, fetchDoctor, fetchDoctorClinics } from '@/services/api';
import { mn } from '@/i18n/mn';
import { formatDayCodes } from '@/i18n/datetime';
import { spacing } from '@/theme/tokens';
import {
  Badge,
  Card,
  ErrorState,
  Heading,
  LoadingState,
  Muted,
  NotImplemented,
  Row,
  Screen,
  Title,
} from '@/ui/components';

/**
 * Screen 14 — Эмчийн профайл.
 * Phase 1 shows the profile and the clinics. The visit history it will
 * eventually carry needs the visit tables, which arrive in Phase 4.
 */
export default function DoctorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['doctor', id],
    queryFn: async () => {
      const doctor = await fetchDoctor(id);
      const links = await fetchDoctorClinics(id);
      const allClinics = await fetchClinics();
      const clinics = links
        .map((l) => ({ link: l, clinic: allClinics.find((c) => c.id === l.clinic_id) }))
        .filter((x) => x.clinic !== undefined);
      return { doctor, clinics };
    },
    enabled: Boolean(id),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { doctor, clinics } = query.data;

  return (
    <>
      <Stack.Screen options={{ title: mn.doctors.detailTitle }} />
      <Screen>
        <Title>{doctor.full_name}</Title>
        <Badge label={doctor.speciality} tone="info" />

        <Card>
          <Row label={mn.doctors.speciality} value={doctor.speciality} />
          <Row label={mn.doctors.phone} value={doctor.phone} />
          <Row label={mn.doctors.email} value={doctor.email} />
          <Row label={mn.doctors.professionalNotes} value={doctor.professional_notes} />
        </Card>

        <Heading>{mn.doctors.clinics}</Heading>
        {clinics.length === 0 ? (
          <Muted>{mn.common.noData}</Muted>
        ) : (
          <View style={{ gap: spacing.md }}>
            {clinics.map(({ link, clinic }) => (
              <Card key={link.id}>
                <Heading>{clinic!.name}</Heading>
                <Muted>{clinic!.district}</Muted>
                <Row label={mn.doctors.department} value={link.department} />
                <Row label={mn.doctors.room} value={link.room_or_floor} />
                <Row
                  label={mn.doctors.availableDays}
                  value={formatDayCodes(link.available_days)}
                />
                <Row label={mn.doctors.availableHours} value={link.available_hours} />
              </Card>
            ))}
          </View>
        )}

        <Heading>{mn.doctors.visitHistory}</Heading>
        <NotImplemented
          what="Өмнөх уулзалтын түүх, шүүлтүүр, албан ёсны нэмэлт тайлбар"
          phase="Шат 4"
        />
      </Screen>
    </>
  );
}
