/**
 * Screen 18 — Хүсэлт батлах (Exception approval queue)
 *
 * The manager's decision screen. Its most important feature is that it shows
 * the KPI CONSEQUENCE before the decision, not after: approving a sick-leave
 * request removes the visit from the denominator, approving a
 * "doctor unavailable" does not. A manager who only learns that afterwards
 * cannot make a fair call.
 *
 * It also shows the measured distance and GPS accuracy from the moment the
 * request was made, which is usually the whole story for a "GPS problem".
 */
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  fetchPendingExceptions,
  reviewException,
  type PendingException,
} from '../../src/data/kpi';
import {
  Card,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { exceptionReasonMn, translateEnum } from '../../src/lib/i18n/enums';
import { formatDateMn, formatDateTimeMn } from '../../src/lib/datetime';
import { formatDistanceMn } from '../../src/domain/geo';
import { colors, radius, spacing, typography } from '../../src/theme';

export default function ExceptionQueueScreen() {
  const [items, setItems] = useState<PendingException[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);

    const result = await fetchPendingExceptions();
    setItems(result.data ?? []);
    setError(result.error);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const decide = (item: PendingException, approve: boolean) => {
    const comment = (comments[item.exception_id] ?? '').trim();

    if (!approve && !comment) {
      Alert.alert(mn.exception.reject, mn.exception.commentRequiredOnReject);
      return;
    }

    Alert.alert(
      approve ? mn.exception.approve : mn.exception.reject,
      approve ? mn.exception.confirmApprove : mn.exception.confirmReject,
      [
        { text: mn.common.cancel, style: 'cancel' },
        {
          text: approve ? mn.exception.approve : mn.exception.reject,
          style: approve ? 'default' : 'destructive',
          onPress: async () => {
            setBusyId(item.exception_id);
            const result = await reviewException(item.exception_id, approve, comment || null);
            setBusyId(null);

            if (result.error) {
              Alert.alert(mn.common.error, result.error);
              return;
            }
            Alert.alert(
              mn.exception.queueTitle,
              approve ? mn.exception.approved : mn.exception.rejected,
            );
            await load('refresh');
          },
        },
      ],
    );
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load('initial')} />;
  if (items.length === 0) return <EmptyState label={mn.exception.queueEmpty} />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
      }
    >
      {items.map((item) => {
        const outsideRadius =
          item.distance_from_clinic_m !== null &&
          item.clinic_radius_m !== null &&
          Number(item.distance_from_clinic_m) > Number(item.clinic_radius_m);

        return (
          <Card key={item.exception_id}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.repName}>{item.rep_name}</Text>
                <Text style={styles.meta}>
                  {item.clinic_name} · {formatDateMn(item.planned_date)}
                </Text>
              </View>
              <Pill
                label={translateEnum(exceptionReasonMn, item.reason_category)}
                tone="warning"
              />
            </View>

            <Text style={styles.label}>{mn.visitDetail.doctors}</Text>
            <Text style={styles.value}>{item.doctor_names.join(', ') || '—'}</Text>

            <Text style={styles.label}>{mn.exception.explanation}</Text>
            <Text style={styles.explanation}>{item.explanation}</Text>

            {/* The evidence, when the rep chose to attach it. */}
            {item.distance_from_clinic_m !== null ? (
              <View style={[styles.evidence, outsideRadius && styles.evidenceWarn]}>
                <Text style={styles.evidenceText}>
                  {mn.exception.distanceAtRequest}:{' '}
                  {formatDistanceMn(Number(item.distance_from_clinic_m))}
                  {item.clinic_radius_m !== null
                    ? ` · ${mn.startVisit.radiusLabel}: ${item.clinic_radius_m} м`
                    : ''}
                </Text>
                {item.accuracy_m !== null ? (
                  <Text style={styles.evidenceText}>
                    {mn.startVisit.accuracyLabel}: ± {Math.round(Number(item.accuracy_m))} м
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.meta}>
              {mn.exception.requestedAt}: {formatDateTimeMn(item.requested_at_server)}
            </Text>

            {/* The consequence, stated BEFORE the decision. */}
            <View
              style={[
                styles.kpiImpact,
                item.excludes_from_kpi_if_approved ? styles.kpiExcluded : styles.kpiCounted,
              ]}
            >
              <Text
                style={[
                  styles.kpiImpactText,
                  item.excludes_from_kpi_if_approved
                    ? styles.kpiExcludedText
                    : styles.kpiCountedText,
                ]}
              >
                {item.excludes_from_kpi_if_approved
                  ? mn.exception.willExcludeKpi
                  : mn.exception.willNotExcludeKpi}
              </Text>
            </View>

            <LabelledInput
              label={mn.exception.comment}
              value={comments[item.exception_id] ?? ''}
              onChangeText={(text) =>
                setComments((current) => ({ ...current, [item.exception_id]: text }))
              }
              multiline
            />

            <PrimaryButton
              label={mn.exception.approve}
              onPress={() => decide(item, true)}
              busy={busyId === item.exception_id}
            />
            <SecondaryButton
              label={mn.exception.reject}
              onPress={() => decide(item, false)}
              disabled={busyId === item.exception_id}
            />
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  repName: { ...typography.heading, color: colors.text },
  meta: { ...typography.caption, color: colors.textMuted },

  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },
  value: { ...typography.body, color: colors.text },
  explanation: { ...typography.body, color: colors.text, lineHeight: 22 },

  evidence: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: 2,
  },
  evidenceWarn: { backgroundColor: colors.warningBg },
  evidenceText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  kpiImpact: { borderRadius: radius.sm, padding: spacing.md },
  kpiExcluded: { backgroundColor: colors.successBg },
  kpiCounted: { backgroundColor: colors.dangerBg },
  kpiImpactText: { ...typography.bodyStrong, textAlign: 'center' },
  kpiExcludedText: { color: colors.success },
  kpiCountedText: { color: colors.danger },
});
