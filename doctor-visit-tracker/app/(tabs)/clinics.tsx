/**
 * Screen 11 — Эмнэлгүүд (Clinics)
 *
 * Search plus a district filter. Both are client-side over the cached list:
 * 15 clinics is a small, stable dataset, so filtering locally is instant and
 * keeps working when the connection drops.
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
import { fetchClinics } from '../../src/data/repositories';
import { EmptyState, ErrorState, LoadingState, Pill } from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { colors, radius, spacing, touch, typography } from '../../src/theme';
import type { Clinic } from '../../src/data/types';

export default function ClinicsScreen() {
  const router = useRouter();
  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(fetchClinics, []);

  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState<string | null>(null);

  const districts = useMemo(() => {
    const unique = new Set((data ?? []).map((c) => c.district));
    return Array.from(unique).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((clinic) => {
      if (district && clinic.district !== district) return false;
      if (!needle) return true;
      return (
        clinic.name.toLowerCase().includes(needle) ||
        clinic.district.toLowerCase().includes(needle) ||
        clinic.address.toLowerCase().includes(needle) ||
        clinic.clinic_type.toLowerCase().includes(needle)
      );
    });
  }, [data, query, district]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={mn.clinics.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          accessibilityLabel={mn.clinics.searchPlaceholder}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        <FlatList
          horizontal
          data={[null, ...districts]}
          keyExtractor={(item) => item ?? '__all__'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item }) => {
            const selected = district === item;
            return (
              <Pressable
                onPress={() => setDistrict(item)}
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

        <Text style={styles.count}>{mn.clinics.count(filtered.length)}</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<EmptyState label={mn.clinics.empty} />}
        renderItem={({ item }) => <ClinicRow clinic={item} onPress={() => router.push(`/clinic/${item.id}`)} />}
      />
    </View>
  );
}

function ClinicRow({ clinic, onPress }: { clinic: Clinic; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {clinic.name}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {clinic.district} · {clinic.clinic_type}
        </Text>
        <Text style={styles.rowAddress} numberOfLines={2}>
          {clinic.address}
        </Text>
      </View>
      <View style={styles.rowSide}>
        {clinic.is_active ? null : <Pill label={mn.common.inactive} tone="warning" />}
        <Text style={styles.radius}>{clinic.geofence_radius_m} м</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
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
    minHeight: 76,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  rowAddress: { ...typography.caption, color: colors.textMuted },
  rowSide: { alignItems: 'flex-end', gap: 2 },
  radius: { ...typography.caption, color: colors.textFaint },
  chevron: { fontSize: 26, color: colors.textFaint, lineHeight: 28 },
});
