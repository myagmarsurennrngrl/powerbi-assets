import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchDoctors, type Doctor } from '@/services/api';
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

/** Screen 13 — Эмч нар. */
export default function DoctorsScreen() {
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['doctors'], queryFn: () => fetchDoctors() });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return rows;
    return rows.filter(
      (d) =>
        d.full_name.toLowerCase().includes(needle) ||
        d.speciality.toLowerCase().includes(needle),
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
      <Stack.Screen options={{ title: mn.doctors.title }} />
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
          ListEmptyComponent={<EmptyState message={mn.doctors.empty} />}
          renderItem={({ item }) => <DoctorRow doctor={item} />}
        />
      </View>
    </>
  );
}

function DoctorRow({ doctor }: { doctor: Doctor }) {
  return (
    <Card onPress={() => router.push(`/(app)/directory/doctor/${doctor.id}`)}>
      <Heading>{doctor.full_name}</Heading>
      <Muted>{doctor.speciality}</Muted>
      {!doctor.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
    </Card>
  );
}
