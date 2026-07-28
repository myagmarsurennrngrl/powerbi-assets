/**
 * Screen 16 — Миний KPI (Representative KPI)
 *
 * People change their behaviour to match whatever a number rewards, so this
 * screen is built to be UNDERSTOOD, not just displayed:
 *
 *  - the formula is shown on the screen, not buried in a document;
 *  - the denominator is shown next to the percentage, so 100% from 2 visits
 *    never looks like 100% from 20;
 *  - "no eligible visits" reads «Хамаарахгүй», never 0% — a representative on
 *    approved sick leave has not failed;
 *  - unplanned visits appear in their own box, explicitly labelled as excluded
 *    from the ratio;
 *  - an unfinished period is marked «Урьдчилсан».
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import { fetchBrandActivity, fetchRepKpi, type BrandActivity, type RepKpi } from '../../src/data/kpi';
import { Card, ErrorState, LoadingState, Pill, Section } from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import {
  addDays,
  formatDateMn,
  formatDurationMn,
  startOfIsoWeek,
  todayLocal,
} from '../../src/lib/datetime';
import { colors, radius, spacing, touch, typography } from '../../src/theme';

type Period = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';

function periodRange(period: Period): { from: string; to: string; open: boolean } {
  const today = todayLocal();
  const thisMonday = startOfIsoWeek(today);

  switch (period) {
    case 'thisWeek':
      return { from: thisMonday, to: addDays(thisMonday, 6), open: true };
    case 'lastWeek': {
      const start = addDays(thisMonday, -7);
      return { from: start, to: addDays(start, 6), open: false };
    }
    case 'thisMonth': {
      const [year, month] = today.split('-');
      const from = `${year}-${month}-01`;
      const nextMonthFirst = new Date(Date.UTC(Number(year), Number(month), 1));
      const to = new Date(nextMonthFirst.getTime() - 86_400_000).toISOString().slice(0, 10);
      return { from, to, open: true };
    }
    default: {
      const [year, month] = today.split('-');
      const firstOfThis = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
      const lastOfPrev = new Date(firstOfThis.getTime() - 86_400_000);
      const from = `${lastOfPrev.getUTCFullYear()}-${String(lastOfPrev.getUTCMonth() + 1).padStart(2, '0')}-01`;
      return { from, to: lastOfPrev.toISOString().slice(0, 10), open: false };
    }
  }
}

export default function KpiScreen() {
  const { profile } = useSession();
  const [period, setPeriod] = useState<Period>('thisWeek');

  const [kpi, setKpi] = useState<RepKpi | null>(null);
  const [brands, setBrands] = useState<BrandActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!profile) return;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      const [kpiResult, brandResult] = await Promise.all([
        fetchRepKpi(profile.id, range.from, range.to),
        fetchBrandActivity(profile.id, range.from, range.to),
      ]);

      setKpi(kpiResult.data);
      setBrands(brandResult.data ?? []);
      setError(kpiResult.error);

      setLoading(false);
      setRefreshing(false);
    },
    [profile, range.from, range.to],
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  if (!profile || loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load('initial')} />;

  const hasNoEligible = !kpi || kpi.eligible_visits === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
      }
    >
      {/* Period picker */}
      <View style={styles.periodRow}>
        {(
          [
            ['thisWeek', mn.kpi.thisWeek],
            ['lastWeek', mn.kpi.lastWeek],
            ['thisMonth', mn.kpi.thisMonth],
            ['lastMonth', mn.kpi.lastMonth],
          ] as Array<[Period, string]>
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setPeriod(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: period === key }}
            style={[styles.periodChip, period === key && styles.periodChipSelected]}
          >
            <Text style={[styles.periodText, period === key && styles.periodTextSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.range}>
        {formatDateMn(range.from)} – {formatDateMn(range.to)}
      </Text>

      {range.open ? (
        <View style={styles.provisional}>
          <Pill label={mn.kpi.provisional} tone="warning" />
          <Text style={styles.provisionalText}>{mn.kpi.provisionalHint}</Text>
        </View>
      ) : null}

      {/* The headline. NULL is shown as «Хамаарахгүй», never as 0%. */}
      <View style={[styles.hero, hasNoEligible && styles.heroNeutral]}>
        <Text style={styles.heroLabel}>{mn.kpi.completion}</Text>
        {hasNoEligible || kpi?.completion_pct === null ? (
          <>
            <Text style={styles.heroNa}>{mn.kpi.completionNotApplicable}</Text>
            <Text style={styles.heroHint}>{mn.kpi.completionNotApplicableHint}</Text>
          </>
        ) : (
          <>
            <Text style={styles.heroValue}>{Number(kpi!.completion_pct).toFixed(1)}%</Text>
            {/* The raw counts always sit next to the percentage. */}
            <Text style={styles.heroHint}>
              {kpi!.completed_visits} / {kpi!.eligible_visits}
            </Text>
          </>
        )}
        <Text style={styles.heroFormula}>{mn.kpi.formula}</Text>
      </View>

      <Section title={mn.kpi.title}>
        <View style={styles.grid}>
          <Metric label={mn.kpi.planned} value={kpi?.planned_visits ?? 0} />
          <Metric label={mn.kpi.completed} value={kpi?.completed_visits ?? 0} tone="success" />
          <Metric label={mn.kpi.missed} value={kpi?.missed_visits ?? 0} tone="danger" />
          <Metric label={mn.kpi.eligible} value={kpi?.eligible_visits ?? 0} />
          <Metric
            label={mn.kpi.approvedCancellations}
            value={kpi?.approved_cancellations ?? 0}
          />
          <Metric
            label={mn.kpi.unapprovedCancellations}
            value={kpi?.unapproved_cancellations ?? 0}
            tone="danger"
          />
        </View>
      </Section>

      {/* Deliberately its own box, with the exclusion stated. */}
      <Section title={mn.kpi.unplanned}>
        <Card>
          <View style={styles.unplannedRow}>
            <Text style={styles.unplannedValue}>{kpi?.unplanned_visits ?? 0}</Text>
            <Text style={styles.unplannedHint}>{mn.kpi.unplannedHint}</Text>
          </View>
        </Card>
      </Section>

      <Section title={mn.kpi.title}>
        <Card>
          <Row
            label={mn.kpi.avgDuration}
            value={formatDurationMn(kpi?.avg_duration_seconds ?? null)}
          />
          <Row label={mn.kpi.onTime} value={pct(kpi?.on_time_pct)} />
          <Row label={mn.kpi.doctorCoverage} value={pct(kpi?.doctor_coverage_pct)} />
          <Row label={mn.kpi.clinicCoverage} value={pct(kpi?.clinic_coverage_pct)} />
          <Row
            label={mn.kpi.followUpCompletion}
            value={pct(kpi?.follow_up_completion_pct)}
          />
        </Card>
      </Section>

      <Section title={mn.kpi.brandActivity}>
        <Card>
          {brands.length === 0 ? (
            <Text style={styles.muted}>{mn.kpi.noData}</Text>
          ) : (
            brands.map((brand) => {
              const max = Math.max(...brands.map((b) => Number(b.visit_count)), 1);
              const width = `${(Number(brand.visit_count) / max) * 100}%` as const;
              return (
                <View key={brand.brand_id} style={styles.brandRow}>
                  <Text style={styles.brandName}>{brand.brand_name}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width }]} />
                  </View>
                  <Text style={styles.brandCount}>{brand.visit_count}</Text>
                </View>
              );
            })
          )}
        </Card>
      </Section>
    </ScrollView>
  );
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(1)}%`;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <View style={styles.metric}>
      <Text
        style={[
          styles.metricValue,
          tone === 'success' && styles.metricSuccess,
          tone === 'danger' && styles.metricDanger,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  periodChip: {
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  periodTextSelected: { color: colors.onPrimary },
  range: { ...typography.caption, color: colors.textMuted },

  provisional: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  provisionalText: { ...typography.caption, color: colors.warning, flex: 1 },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroNeutral: { backgroundColor: colors.neutral },
  heroLabel: { ...typography.label, color: colors.primaryLight },
  heroValue: { fontSize: 52, fontWeight: '700', color: colors.onPrimary },
  heroNa: { ...typography.title, color: colors.onPrimary, textAlign: 'center' },
  heroHint: { ...typography.caption, color: colors.primaryLight, textAlign: 'center' },
  heroFormula: {
    ...typography.caption,
    color: colors.primaryLight,
    textAlign: 'center',
    marginTop: spacing.sm,
    opacity: 0.9,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: { ...typography.display, color: colors.text },
  metricSuccess: { color: colors.success },
  metricDanger: { color: colors.danger },
  metricLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  unplannedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  unplannedValue: { ...typography.display, color: colors.info },
  unplannedHint: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: touch.row,
    gap: spacing.md,
  },
  rowLabel: { ...typography.body, color: colors.textMuted, flex: 1 },
  rowValue: { ...typography.bodyStrong, color: colors.text },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  brandName: { ...typography.caption, color: colors.text, width: 96 },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  brandCount: { ...typography.caption, color: colors.textMuted, width: 28, textAlign: 'right' },

  muted: { ...typography.body, color: colors.textMuted },
});
