/**
 * Screen 13 — Эмч нар (Doctors)
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchDoctors } from '../../src/data/repositories';
import { EmptyState, ErrorState, LoadingState, Pill } from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { colors, radius, spacing, touch, typography } from '../../src/theme';
import type { Doctor } from '../../src/data/types';

export default function DoctorsScreen() {
  const router = useRouter();
  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(fetchDoctors, []);

  const [query, setQuery] = useState('');
  const [speciality, setSpeciality] = useState<string | null>(null);

  const specialities = useMemo(() => {
    const unique = new Set((data ?? []).map((d) => d.speciality));
    return Array.from(unique).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((doctor) => {
      if (speciality && doctor.speciality !== speciality) return false;
      if (!needle) return true;
      return (
        doctor.full_name.toLowerCase().includes(needle) ||
        doctor.speciality.toLowerCase().includes(needle)
      );
    });
  }, [data, query, speciality]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={mn.doctors.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          accessibilityLabel={mn.doctors.searchPlaceholder}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        <FlatList
          horizontal
          data={[null, ...specialities]}
          keyExtractor={(item) => item ?? '__all__'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item }) => {
            const selected = speciality === item;
            return (
              <Pressable
                onPress={() => setSpeciality(item)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.filterChip, selected && styles.filterChipSelected]}
              >
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {item ?? mn.common.all}
                </Text>
              </Pressable>
            );
          }}
        />

        <Text style={styles.count}>{mn.doctors.count(filtered.length)}</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<EmptyState label={mn.doctors.empty} />}
        renderItem={({ item }) => (
          <DoctorRow doctor={item} onPress={() => router.push(`/doctor/${item.id}`)} />
        )}
      />
    </View>
  );
}

function DoctorRow({ doctor, onPress }: { doctor: Doctor; onPress: () => void }) {
  // Initial letter for the avatar circle. Mongolian names are stored as
  // "А. Алтанцэцэг", so the first character is already the useful one.
  const initial = doctor.full_name.trim().charAt(0).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {doctor.full_name}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {doctor.speciality}
        </Text>
      </View>
      {doctor.is_active ? null : <Pill label={mn.common.inactive} tone="warning" />}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  toolbar: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  search: {
    minHeight: touch.button,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  filterRow: { gap: spacing.sm, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  filterChipTextSelected: { color: colors.onPrimary },
  count: { ...typography.caption, color: colors.textMuted },

  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: touch.row + 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.heading, color: colors.primaryDark },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textMuted },
  chevron: { fontSize: 26, color: colors.textFaint, lineHeight: 28 },
});
