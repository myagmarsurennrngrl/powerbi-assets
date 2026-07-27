/**
 * Screen 2 — Нүүр (Home dashboard)
 *
 * PHASE 1 HONESTY NOTE
 * --------------------
 * The full dashboard needs plans and visits, which arrive in Phases 2 and 3.
 * Rather than showing fake numbers, this screen shows what genuinely works
 * today (identity, role, assigned brands, master-data counts) and labels
 * everything else as «Хараахан хэрэгжээгүй» with the phase it is coming in.
 * No tile displays a number the database cannot yet produce.
 */
import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchBrands, fetchMyBrandAssignments } from '../../src/data/repositories';
import {
  Card,
  Chip,
  ErrorState,
  LoadingState,
  NotImplemented,
  Section,
  SecondaryButton,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { userRoleMn } from '../../src/lib/i18n/enums';
import { formatDateLongMn } from '../../src/lib/datetime';
import { colors, radius, spacing, typography } from '../../src/theme';

export default function HomeScreen() {
  const { profile } = useSession();
  const router = useRouter();

  const loader = useCallback(async () => {
    if (!profile) return { data: null, error: null };

    const [assignments, brands] = await Promise.all([
      fetchMyBrandAssignments(profile.id),
      fetchBrands(),
    ]);

    if (assignments.error) return { data: null, error: assignments.error };
    if (brands.error) return { data: null, error: brands.error };

    const byId = new Map((brands.data ?? []).map((b) => [b.id, b]));
    const myBrands = (assignments.data ?? [])
      .map((a) => byId.get(a.brand_id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    return { data: { myBrands }, error: null };
  }, [profile]);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(loader, [profile?.id]);

  if (!profile) return <LoadingState />;
  if (loading) return <LoadingState />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.greeting}>{mn.home.greeting(profile.full_name)}</Text>
        <Text style={styles.role}>{userRoleMn[profile.role]}</Text>
        <Text style={styles.date}>{formatDateLongMn(new Date())}</Text>
      </View>

      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {profile.role === 'representative' ? (
        <Section title={mn.home.myBrands}>
          <Card>
            {data?.myBrands.length ? (
              <View style={styles.chipRow}>
                {data.myBrands.map((brand) => (
                  <Chip key={brand.id} label={brand.name} />
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>{mn.brands.empty}</Text>
            )}
          </Card>
        </Section>
      ) : null}

      {/*
        These tiles need weekly plans (Phase 2) and visits (Phase 3). Showing
        a zero here would read as "you have nothing planned", which is a lie —
        the feature simply does not exist yet.
      */}
      <Section title={mn.home.todayPlanned}>
        <NotImplemented
          what={mn.home.goToToday}
          hint="Долоо хоногийн төлөвлөгөө ба өнөөдрийн маршрут 2-р шатанд нэмэгдэнэ."
        />
      </Section>

      <Section title={mn.home.weekKpi}>
        <NotImplemented
          what="KPI"
          hint="Уулзалтын бүртгэл эхэлсний дараа, 5-р шатанд тооцоологдоно."
        />
      </Section>

      <Section title={mn.home.quickLinks}>
        <View style={styles.linkColumn}>
          <SecondaryButton
            label={mn.clinics.title}
            onPress={() => router.push('/(tabs)/clinics')}
          />
          <SecondaryButton
            label={mn.doctors.title}
            onPress={() => router.push('/(tabs)/doctors')}
          />
          <SecondaryButton
            label={mn.brands.title}
            onPress={() => router.push('/(tabs)/brands')}
          />
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
  },
  greeting: { ...typography.title, color: colors.onPrimary },
  role: { ...typography.body, color: colors.primaryLight },
  date: { ...typography.caption, color: colors.primaryLight, marginTop: spacing.xs },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted },
  linkColumn: { gap: spacing.sm },
});
