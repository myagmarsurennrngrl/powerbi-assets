import React from 'react';
import { Linking, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchClinic, fetchClinicDoctors, fetchDoctors } from '@/services/api';
import { mn } from '@/i18n/mn';
import { formatDayCodes } from '@/i18n/datetime';
import { spacing } from '@/theme/tokens';
import {
  Button,
  Card,
  ErrorState,
  Heading,
  LoadingState,
  Muted,
  Row,
  Screen,
  Title,
} from '@/ui/components';

/** Screen 12 — Эмнэлгийн дэлгэрэнгүй. */
export default function ClinicDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['clinic', id],
    queryFn: async () => {
      const clinic = await fetchClinic(id);
      const links = await fetchClinicDoctors(id);
      const allDoctors = await fetchDoctors();
      const doctors = links
        .map((l) => ({ link: l, doctor: allDoctors.find((d) => d.id === l.doctor_id) }))
        .filter((x) => x.doctor !== undefined);
      return { clinic, doctors };
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

  const { clinic, doctors } = query.data;

  /**
   * Opens the platform's own map application with a pin. Nothing is tracked and
   * no location permission is requested — this just hands the coordinates over.
   */
  function openInMaps() {
    const label = encodeURIComponent(clinic.name);
    const coords = `${clinic.latitude},${clinic.longitude}`;
    const url =
      Platform.OS === 'ios'
        ? `maps://?q=${label}&ll=${coords}`
        : `geo:${coords}?q=${coords}(${label})`;
    void Linking.openURL(url).catch(() => {
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${coords}`);
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: mn.clinics.detailTitle }} />
      <Screen>
        <Title>{clinic.name}</Title>

        <Card>
          <Row label={mn.clinics.type} value={mn.clinics.types[clinic.clinic_type]} />
          <Row label={mn.clinics.district} value={clinic.district} />
          <Row label={mn.clinics.address} value={clinic.address} />
          <Row label={mn.clinics.phone} value={clinic.contact_phone} />
          <Row
            label={mn.clinics.coordinates}
            value={`${clinic.latitude.toFixed(6)}, ${clinic.longitude.toFixed(6)}`}
          />
          <Row label={mn.clinics.radius} value={`${clinic.geofence_radius_m} м`} emphasis />
          <Row label={mn.clinics.notes} value={clinic.notes} />
        </Card>

        <Button label={mn.clinics.openInMaps} onPress={openInMaps} variant="secondary" />

        <Heading>{mn.clinics.doctorsHere}</Heading>
        {doctors.length === 0 ? (
          <Muted>{mn.common.noData}</Muted>
        ) : (
          <View style={{ gap: spacing.md }}>
            {doctors.map(({ link, doctor }) => (
              <Card key={link.id}>
                <Heading>{doctor!.full_name}</Heading>
                <Muted>{doctor!.speciality}</Muted>
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
      </Screen>
    </>
  );
}
