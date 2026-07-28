/**
 * Screen 17 — Менежерийн самбар (Manager dashboard)
 *
 * ONE EDITORIAL DECISION SHAPES THIS SCREEN.
 *
 * The brief asks for "visits started outside expected conditions". That list
 * is easy to present as a wall of shame, and if it is, the app becomes
 * something done to people rather than for them — and representatives will
 * work around it rather than with it.
 *
 * So it is labelled «Шалгах шаардлагатай» (needs checking), every row states
 * WHY it is there, and the section carries a standing note that an innocent
 * explanation is usually available: a hospital basement, a queued offline
 * check-in. It is a prompt to look, not a verdict.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  exportVisitsCsv,
  fetchDashboard,
  fetchRecentVisits,
  fetchReviewList,
  fetchUncoveredClinics,
  type DashboardSummary,
  type RecentVisit,
  type ReviewItem,
  type UncoveredClinic,
} from '../../src/data/dashboard';
import { fetchTeamKpi, type TeamKpiRow } from '../../src/data/kpi';
import {
  Card,
  ErrorState,
  LoadingState,
  Pill,
  PrimaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { translateEnum, visitOutcomeMn } from '../../src/lib/i18n/enums';
import { addDays, formatDateMn, formatDurationMn, todayLocal } from '../../src/lib/datetime';
import { formatDistanceMn } from '../../src/domain/geo';
import { colors, radius, spacing, typography } from '../../src/theme';

type Period = 7 | 28 | 90;

export default function ManagerDashboardScreen() {
  const router = useRouter();
  const [days, setDays] = useState<Period>(28);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [team, setTeam] = useState<TeamKpiRow[]>([]);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [uncovered, setUncovered] = useState<UncoveredClinic[]>([]);
  const [recent, setRecent] = useState<RecentVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const to = todayLocal();
    return { from: addDays(to, -(days - 1)), to };
  }, [days]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      const [s, t, r, u, rv] = await Promise.all([
        fetchDashboard(range.from, range.to),
        fetchTeamKpi(range.from, range.to),
        fetchReviewList(range.from, range.to),
        fetchUncoveredClinics(range.from, range.to),
        fetchRecentVisits(15),
      ]);

      setSummary(s.data);
      setTeam(t.data ?? []);
      setReview(r.data ?? []);
      setUncovered(u.data ?? []);
      setRecent(rv.data ?? []);
      setError(s.error ?? t.error);

      setLoading(false);
      setRefreshing(false);
    },
    [range.from, range.to],
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const doExport = async () => {
    setExporting(true);
    const result = await exportVisitsCsv(range.from, range.to);
    setExporting(false);

    if (result.error || !result.data) {
      Alert.alert(mn.common.error, result.error ?? mn.errors.loadFailed);
      return;
    }
    // The rows and the audit entry both exist; writing the file to disk or
    // sharing it is Phase 7 (it needs expo-file-system + expo-sharing).
    Alert.alert(
      mn.dashboard.export,
      `${mn.dashboard.exportDone(result.data.rowCount)}\n\n${mn.dashboard.exportAudited}`,
    );
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load('initial')} />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
      }
    >
      <View style={styles.periodRow}>
        {(
          [
            [7, mn.dashboard.last7],
            [28, mn.dashboard.last28],
            [90, mn.dashboard.last90],
          ] as Array<[Period, string]>
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => setDays(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: days === value }}
            style={[styles.periodChip, days === value && styles.periodChipSelected]}
          >
            <Text style={[styles.periodText, days === value && styles.periodTextSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.range}>
        {formatDateMn(range.from)} – {formatDateMn(range.to)}
      </Text>

      {/* Team completion */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{mn.dashboard.teamCompletion}</Text>
        {summary?.team_completion_pct === null || summary === null ? (
          <Text style={styles.heroNa}>{mn.kpi.completionNotApplicable}</Text>
        ) : (
          <>
            <Text style={styles.heroValue}>
              {Number(summary.team_completion_pct).toFixed(1)}%
            </Text>
            <Text style={styles.heroHint}>
              {summary.team_completed} / {summary.team_eligible}
            </Text>
          </>
        )}
      </View>

      <View style={styles.tileRow}>
        <Tile label={mn.dashboard.missedVisits} value={summary?.total_missed ?? 0} tone="danger" />
        <Tile
          label={mn.dashboard.pendingExceptions}
          value={summary?.pending_exceptions ?? 0}
          tone="warning"
          onPress={() => router.push('/(tabs)/exceptions')}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile label={mn.dashboard.uncoveredClinics} value={summary?.clinics_not_visited ?? 0} />
        <Tile label={mn.dashboard.uncoveredDoctors} value={summary?.doctors_not_visited ?? 0} />
      </View>

      {/* Ranking — percentages always with their counts. */}
      <Section title={mn.dashboard.teamRanking}>
        <Card>
          {team.map((row, index) => (
            <View key={row.rep_id} style={styles.rankRow}>
              <Text style={styles.rankIndex}>{index + 1}</Text>
              <Text style={styles.rankName} numberOfLines={1}>
                {row.rep_name}
              </Text>
              <Text style={styles.rankCounts}>
                {row.completed_visits}/{row.eligible_visits}
              </Text>
              <Text style={styles.rankPct}>
                {row.completion_pct === null
                  ? '—'
                  : `${Number(row.completion_pct).toFixed(0)}%`}
              </Text>
            </View>
          ))}
        </Card>
      </Section>

      {/* The review list — framed as a prompt, not a verdict. */}
      <Section title={`${mn.dashboard.needsReview} (${review.length})`}>
        <View style={styles.reviewNote}>
          <Text style={styles.reviewNoteText}>{mn.dashboard.needsReviewHint}</Text>
        </View>
        {review.length === 0 ? (
          <Card>
            <Text style={styles.muted}>{mn.dashboard.noReviewItems}</Text>
          </Card>
        ) : (
          review.slice(0, 10).map((item) => (
            <Card key={item.visit_key}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewRep}>{item.rep_name}</Text>
                <Text style={styles.muted}>{formatDateMn(item.visit_date)}</Text>
              </View>
              <Text style={styles.muted}>{item.clinic_name}</Text>

              <View style={styles.reasonRow}>
                {item.reasons.map((reason) => (
                  <Pill key={reason} label={reason} tone="warning" />
                ))}
              </View>

              <Text style={styles.reviewMeta}>
                {item.distance_m !== null
                  ? `${mn.startVisit.distanceLabel}: ${formatDistanceMn(Number(item.distance_m))}`
                  : ''}
                {item.radius_m !== null ? ` · ${mn.startVisit.radiusLabel}: ${item.radius_m} м` : ''}
                {item.duration_seconds !== null
                  ? ` · ${formatDurationMn(item.duration_seconds)}`
                  : ''}
              </Text>
            </Card>
          ))
        )}
      </Section>

      {/* Uncovered clinics */}
      {uncovered.length > 0 ? (
        <Section title={`${mn.dashboard.uncoveredClinics} (${uncovered.length})`}>
          <Card>
            {uncovered.slice(0, 12).map((clinic) => (
              <Pressable
                key={clinic.clinic_key}
                onPress={() => router.push(`/clinic/${clinic.clinic_key}`)}
                accessibilityRole="button"
                style={styles.uncoveredRow}
              >
                <View style={styles.uncoveredMain}>
                  <Text style={styles.uncoveredName}>{clinic.clinic_name}</Text>
                  <Text style={styles.muted}>{clinic.district}</Text>
                </View>
                <Text style={styles.muted}>
                  {clinic.last_visit_date
                    ? `${mn.dashboard.lastVisited}: ${formatDateMn(clinic.last_visit_date)}`
                    : mn.dashboard.never}
                </Text>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* Recent visits */}
      <Section title={mn.dashboard.recentVisits}>
        <Card>
          {recent.map((visit) => (
            <View key={visit.visit_key} style={styles.recentRow}>
              <View style={styles.recentMain}>
                <Text style={styles.recentClinic} numberOfLines={1}>
                  {visit.clinic_name}
                </Text>
                <Text style={styles.muted}>
                  {visit.rep_name} · {formatDateMn(visit.visit_date)}
                </Text>
              </View>
              <Text style={styles.muted}>
                {translateEnum(visitOutcomeMn, visit.outcome)}
              </Text>
              {visit.needs_review ? <Pill label="!" tone="warning" /> : null}
            </View>
          ))}
        </Card>
      </Section>

      <Section title={mn.dashboard.export}>
        <Card>
          <Text style={styles.muted}>{mn.dashboard.exportAudited}</Text>
          <PrimaryButton
            label={exporting ? mn.dashboard.exporting : mn.dashboard.export}
            onPress={() => void doExport()}
            busy={exporting}
          />
        </Card>
      </Section>
    </ScrollView>
  );
}

function Tile({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warning';
  onPress?: () => void;
}) {
  const content = (
    <View style={[styles.tile, tone === 'danger' && styles.tileDanger, tone === 'warning' && styles.tileWarning]}>
      <Text
        style={[
          styles.tileValue,
          tone === 'danger' && styles.tileValueDanger,
          tone === 'warning' && styles.tileValueWarning,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.tileWrap}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  periodRow: { flexDirection: 'row', gap: spacing.sm },
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

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroLabel: { ...typography.label, color: colors.primaryLight },
  heroValue: { fontSize: 48, fontWeight: '700', color: colors.onPrimary },
  heroNa: { ...typography.title, color: colors.onPrimary },
  heroHint: { ...typography.caption, color: colors.primaryLight },

  tileRow: { flexDirection: 'row', gap: spacing.sm },
  tileWrap: { flex: 1 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  tileDanger: { borderColor: colors.danger },
  tileWarning: { borderColor: colors.warning },
  tileValue: { ...typography.display, color: colors.text },
  tileValueDanger: { color: colors.danger },
  tileValueWarning: { color: colors.warning },
  tileLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  rankIndex: { ...typography.caption, color: colors.textFaint, width: 18 },
  rankName: { ...typography.body, color: colors.text, flex: 1 },
  rankCounts: { ...typography.caption, color: colors.textMuted, width: 56, textAlign: 'right' },
  rankPct: { ...typography.bodyStrong, color: colors.primary, width: 48, textAlign: 'right' },

  reviewNote: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  reviewNoteText: { ...typography.caption, color: colors.info, lineHeight: 18 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewRep: { ...typography.bodyStrong, color: colors.text },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  reviewMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  uncoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    justifyContent: 'space-between',
  },
  uncoveredMain: { flex: 1 },
  uncoveredName: { ...typography.body, color: colors.text },

  recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46 },
  recentMain: { flex: 1 },
  recentClinic: { ...typography.body, color: colors.text },

  muted: { ...typography.caption, color: colors.textMuted },
});
