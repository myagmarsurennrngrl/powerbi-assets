/**
 * Screen 2 — Нүүр (Home dashboard)
 *
 * PHASE 2 SCOPE
 * -------------
 * Today's planned / remaining counts and this week's plan status are now real,
 * computed from actual plan data. "Completed today" is still shown as pending
 * because a visit cannot be completed until Phase 3 — reporting 0 completed
 * would read as "you have done nothing today", which is not the same thing as
 * "the feature does not exist yet". KPI and follow-ups remain labelled.
 */
import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchBrands, fetchMyBrandAssignments } from '../../src/data/repositories';
import { fetchPlanForWeek, fetchRoute, type PlanStatus, type RouteStop } from '../../src/data/planning';
import {
  Card,
  Chip,
  ErrorState,
  LoadingState,
  NotImplemented,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { planStatusMn, userRoleMn } from '../../src/lib/i18n/enums';
import { formatDateLongMn, startOfIsoWeek } from '../../src/lib/datetime';
import { colors, radius, spacing, typography } from '../../src/theme';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const PLAN_TONE: Record<PlanStatus, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
  active: 'success',
  completed: 'neutral',
  locked: 'neutral',
};

export default function HomeScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const isRep = profile?.role === 'representative';

  const loader = useCallback(async () => {
    if (!profile) return { data: null, error: null };

    const weekStart = startOfIsoWeek(new Date());

    const [assignments, brands, route, plan] = await Promise.all([
      fetchMyBrandAssignments(profile.id),
      fetchBrands(),
      isRep ? fetchRoute() : Promise.resolve({ data: [] as RouteStop[], error: null }),
      isRep ? fetchPlanForWeek(weekStart) : Promise.resolve({ data: null, error: null }),
    ]);

    if (assignments.error) return { data: null, error: assignments.error };
    if (brands.error) return { data: null, error: brands.error };
    if (route.error) return { data: null, error: route.error };

    const byId = new Map((brands.data ?? []).map((b) => [b.id, b]));
    const myBrands = (assignments.data ?? [])
      .map((a) => byId.get(a.brand_id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    const stops = route.data ?? [];

    return {
      data: {
        myBrands,
        stops,
        plan: plan.data ?? null,
        plannedToday: stops.length,
        completedToday: stops.filter((s) => s.status === 'completed').length,
        remainingToday: stops.filter((s) => s.status === 'planned' || s.status === 'in_progress')
          .length,
      },
      error: null,
    };
  }, [profile, isRep]);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(loader, [
    profile?.id,
    isRep,
  ]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!profile || loading) return <LoadingState />;

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

      {isRep ? (
        <>
          <Section title={mn.today.title}>
            <View style={styles.statRow}>
              <Stat label={mn.home.todayPlanned} value={data?.plannedToday ?? 0} tone="primary" />
              <Stat label={mn.home.remainingToday} value={data?.remainingToday ?? 0} tone="warning" />
            </View>

            {/*
              Completion requires check-in/check-out, which is Phase 3. Showing
              "0 completed" would be a claim about the representative's day
              rather than a statement about the software.
            */}
            <NotImplemented
              what={mn.home.completedToday}
              hint="Уулзалт эхлүүлэх, дуусгах үйлдэл 3-р шатанд нэмэгдэнэ."
            />

            <PrimaryButton
              label={mn.home.goToToday}
              onPress={() => router.push('/(tabs)/today')}
            />
          </Section>

          <Section title={mn.week.thisWeek}>
            <Card>
              {data?.plan ? (
                <>
                  <View style={styles.planRow}>
                    <Text style={styles.planLabel}>{mn.week.title}</Text>
                    <Pill
                      label={planStatusMn[data.plan.status]}
                      tone={PLAN_TONE[data.plan.status]}
                    />
                  </View>
                  {data.plan.status === 'rejected' && data.plan.review_comment ? (
                    <Text style={styles.rejection}>{data.plan.review_comment}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.muted}>{mn.week.noPlan}</Text>
              )}
              <SecondaryButton
                label={mn.week.title}
                onPress={() => router.push('/(tabs)/week')}
              />
            </Card>
          </Section>
        </>
      ) : null}

      {isRep ? (
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
            label={mn.brands.title}
            onPress={() => router.push('/(tabs)/brands')}
          />
        </View>
      </Section>
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'warning';
}) {
  return (
    <View style={[styles.stat, tone === 'warning' && styles.statWarning]}>
      <Text style={[styles.statValue, tone === 'warning' && styles.statValueWarning]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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

  statRow: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  statWarning: { borderColor: colors.warning },
  statValue: { ...typography.display, color: colors.primary },
  statValueWarning: { color: colors.warning },
  statLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  planLabel: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  rejection: { ...typography.caption, color: colors.danger, lineHeight: 19 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted },
  linkColumn: { gap: spacing.sm },
});
