import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchClinics, type Clinic } from '@/services/api';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  LoadingState,
  Muted,
} from '@/ui/components';

/** Screen 11 — Эмнэлгүүд. Read-only for every role. */
export default function ClinicsScreen() {
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['clinics'], queryFn: () => fetchClinics() });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.district.toLowerCase().includes(needle) ||
        c.address.toLowerCase().includes(needle),
    );
  }, [query.data, search]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: mn.clinics.title }} />
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
        <Field
          label={mn.common.search}
          value={search}
          onChangeText={setSearch}
          placeholder={mn.common.searchPlaceholder}
          autoCapitalize="none"
        />
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListEmptyComponent={<EmptyState message={mn.clinics.empty} />}
          renderItem={({ item }) => <ClinicRow clinic={item} />}
        />
      </View>
    </>
  );
}

function ClinicRow({ clinic }: { clinic: Clinic }) {
  return (
    <Card onPress={() => router.push(`/(app)/directory/clinic/${clinic.id}`)}>
      <Heading>{clinic.name}</Heading>
      <Muted>{`${clinic.district} · ${mn.clinics.types[clinic.clinic_type]}`}</Muted>
      <Muted>{clinic.address}</Muted>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <Badge label={`${mn.clinics.radius}: ${clinic.geofence_radius_m} м`} tone="info" />
        {!clinic.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
      </View>
    </Card>
  );
}
