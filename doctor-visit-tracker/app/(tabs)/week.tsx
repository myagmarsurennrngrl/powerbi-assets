/**
 * Screen 4 — Долоо хоногийн хуваарь (Weekly calendar)
 *
 * Navigate week by week, see how many visits fall on each day, and open the
 * plan builder. Also where the plan's status and any manager rejection comment
 * are surfaced — a rejected plan is useless to a representative if they cannot
 * see why.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  fetchPlanDeadline,
  fetchPlanForWeek,
  fetchWeekSummary,
  getOrCreatePlan,
  type DaySummary,
  type PlanStatus,
  type WeeklyPlan,
} from '../../src/data/planning';
import { useSession } from '../../src/lib/auth';
import {
  Card,
  ErrorState,
  LoadingState,
  Pill,
  PrimaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { planStatusMn, weekdayFullMn } from '../../src/lib/i18n/enums';
import { addDays, formatDateMn, formatDateTimeMn, isoWeek, startOfIsoWeek, todayLocal } from '../../src/lib/datetime';
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

export default function WeekScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const isRep = profile?.role === 'representative';

  const [weekStart, setWeekStart] = useState(() => startOfIsoWeek(new Date()));
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      const [planResult, summaryResult, deadlineResult] = await Promise.all([
        fetchPlanForWeek(weekStart),
        fetchWeekSummary(weekStart),
        fetchPlanDeadline(weekStart),
      ]);

      setPlan(planResult.data ?? null);
      setDays(summaryResult.data ?? []);
      setDeadline(deadlineResult.data ?? null);
      setError(planResult.error ?? summaryResult.error);

      setLoading(false);
      setRefreshing(false);
    },
    [weekStart],
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const createPlan = async () => {
    setBusy(true);
    const result = await getOrCreatePlan(weekStart);
    setBusy(false);

    if (result.error || !result.data) {
      setError(result.error ?? mn.errors.loadFailed);
      return;
    }
    router.push(`/plan/${result.data}`);
  };

  const { year, week } = isoWeek(weekStart);
  const isCurrentWeek = weekStart === startOfIsoWeek(new Date());
  const today = todayLocal();

  const countFor = (date: string): DaySummary | undefined =>
    days.find((d) => d.planned_date.slice(0, 10) === date);

  const totalVisits = days.reduce((sum, d) => sum + Number(d.visit_count), 0);

  if (loading) return <LoadingState />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
      }
    >
      {/* Week navigator */}
      <View style={styles.navigator}>
        <Pressable
          onPress={() => setWeekStart(addDays(weekStart, -7))}
          accessibilityRole="button"
          accessibilityLabel={mn.week.previousWeek}
          style={({ pressed }) => [styles.navButton, pressed && styles.navPressed]}
        >
          <Text style={styles.navArrow}>‹</Text>
        </Pressable>

        <View style={styles.navCenter}>
          <Text style={styles.weekLabel}>{mn.week.weekLabel(year, week)}</Text>
          <Text style={styles.weekRange}>
            {formatDateMn(weekStart)} – {formatDateMn(addDays(weekStart, 6))}
          </Text>
          {isCurrentWeek ? <Pill label={mn.week.thisWeek} tone="success" /> : null}
        </View>

        <Pressable
          onPress={() => setWeekStart(addDays(weekStart, 7))}
          accessibilityRole="button"
          accessibilityLabel={mn.week.nextWeek}
          style={({ pressed }) => [styles.navButton, pressed && styles.navPressed]}
        >
          <Text style={styles.navArrow}>›</Text>
        </Pressable>
      </View>

      {error ? <ErrorState message={error} onRetry={() => void load('initial')} /> : null}

      {/* Plan status */}
      <Card>
        {plan ? (
          <>
            <View style={styles.planHeader}>
              <Text style={styles.planTitle}>{mn.week.totalVisits(totalVisits)}</Text>
              <Pill label={planStatusMn[plan.status]} tone={PLAN_TONE[plan.status]} />
            </View>

            {deadline ? (
              <Text style={styles.deadline}>{mn.week.deadline(formatDateTimeMn(deadline))}</Text>
            ) : null}

            {plan.status === 'rejected' && plan.review_comment ? (
              <View style={styles.rejection}>
                <Text style={styles.rejectionLabel}>{mn.week.reviewComment}</Text>
                <Text style={styles.rejectionText}>{plan.review_comment}</Text>
              </View>
            ) : null}

            {isRep ? (
              <PrimaryButton
                label={
                  plan.status === 'draft' || plan.status === 'rejected'
                    ? mn.week.editPlan
                    : mn.week.viewPlan
                }
                onPress={() => router.push(`/plan/${plan.id}`)}
              />
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.muted}>{mn.week.noPlan}</Text>
            {isRep ? (
              <PrimaryButton label={mn.week.createPlan} onPress={() => void createPlan()} busy={busy} />
            ) : null}
          </>
        )}
      </Card>

      {/* Day-by-day */}
      <Section title={mn.week.title}>
        {Array.from({ length: 7 }, (_, index) => {
          const date = addDays(weekStart, index);
          const summary = countFor(date);
          const count = Number(summary?.visit_count ?? 0);
          const isToday = date === today;

          return (
            <Pressable
              key={date}
              onPress={() => router.push(`/route/${date}`)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.dayRow,
                isToday && styles.dayRowToday,
                pressed && styles.dayRowPressed,
              ]}
            >
              <View style={styles.dayLeft}>
                <Text style={[styles.dayName, isToday && styles.todayText]}>
                  {weekdayFullMn[index]}
                </Text>
                <Text style={styles.dayDate}>{formatDateMn(date)}</Text>
              </View>

              <View style={styles.dayRight}>
                {count > 0 ? (
                  <>
                    <Text style={[styles.dayCount, isToday && styles.todayText]}>
                      {mn.week.visitsOnDay(count)}
                    </Text>
                    <Text style={styles.dayClinics}>
                      {mn.week.clinicsOnDay(Number(summary?.clinic_count ?? 0))}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.dayEmpty}>{mn.week.noVisitsOnDay}</Text>
                )}
              </View>

              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  navigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  navButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  navPressed: { backgroundColor: colors.surfaceAlt },
  navArrow: { fontSize: 30, color: colors.primary, lineHeight: 34 },
  navCenter: { flex: 1, alignItems: 'center', gap: 2 },
  weekLabel: { ...typography.bodyStrong, color: colors.text },
  weekRange: { ...typography.caption, color: colors.textMuted },

  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  planTitle: { ...typography.heading, color: colors.text, flex: 1 },
  deadline: { ...typography.caption, color: colors.textMuted },
  muted: { ...typography.body, color: colors.textMuted },

  rejection: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  rejectionLabel: { ...typography.label, color: colors.danger },
  rejectionText: { ...typography.body, color: colors.danger, lineHeight: 21 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 64,
  },
  dayRowToday: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryLight },
  dayRowPressed: { backgroundColor: colors.surfaceAlt },
  dayLeft: { flex: 1, gap: 2 },
  dayName: { ...typography.bodyStrong, color: colors.text },
  dayDate: { ...typography.caption, color: colors.textMuted },
  dayRight: { alignItems: 'flex-end', gap: 2 },
  dayCount: { ...typography.bodyStrong, color: colors.primary },
  dayClinics: { ...typography.caption, color: colors.textMuted },
  dayEmpty: { ...typography.caption, color: colors.textFaint },
  todayText: { color: colors.primaryDark },
  chevron: { fontSize: 24, color: colors.textFaint },
});
