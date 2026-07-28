/**
 * Screen 23 — Аудит лог (Audit log)
 *
 * Read-only by construction, not by convention: there is no edit control here
 * because there is no way to edit an audit entry at all — `UPDATE` and
 * `DELETE` are revoked and additionally blocked by a trigger. The screen says
 * so, because a log people believe can be quietly altered is worth nothing.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchAuditLog, type AuditEntry } from '../src/data/dashboard';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SecondaryButton,
} from '../src/components/ui';
import { mn } from '../src/lib/i18n/mn';
import { formatDateTimeMn } from '../src/lib/datetime';
import { colors, radius, spacing, typography } from '../src/theme';

/** The actions worth filtering by, in the order a manager would look for them. */
const FILTERS = [
  'data_export',
  'exception_reviewed',
  'visit_completed',
  'plan_changed',
  'user_role_changed',
  'master_data_changed',
  'setting_changed',
] as const;

export default function AuditLogScreen() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'more', nextOffset = 0, nextAction = action) => {
      if (mode === 'refresh') setRefreshing(true);
      else if (mode === 'more') setLoadingMore(true);
      else setLoading(true);

      const result = await fetchAuditLog({ action: nextAction }, nextOffset);

      if (result.error) {
        setError(result.error);
      } else {
        const rows = result.data ?? [];
        setEntries((current) => (mode === 'more' ? [...current, ...rows] : rows));
        setHasMore(rows.length === 50);
        setOffset(nextOffset);
        setError(null);
      }

      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    },
    [action],
  );

  React.useEffect(() => {
    void load('initial', 0, action);
  }, [action, load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load('initial', 0, action)} />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh', 0, action)}
        />
      }
    >
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{mn.audit.readOnly}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.filterRow}>
          <FilterChip
            label={mn.common.all}
            selected={action === null}
            onPress={() => setAction(null)}
          />
          {FILTERS.map((code) => (
            <FilterChip
              key={code}
              label={mn.audit.actions[code] ?? code}
              selected={action === code}
              onPress={() => setAction(action === code ? null : code)}
            />
          ))}
        </View>
      </ScrollView>

      {entries.length === 0 ? (
        <EmptyState label={mn.audit.empty} />
      ) : (
        entries.map((entry) => (
          <Card key={entry.id}>
            <View style={styles.entryHeader}>
              <Text style={styles.entryAction}>
                {mn.audit.actions[entry.action] ?? entry.action}
              </Text>
              <Text style={styles.entryTime}>{formatDateTimeMn(entry.occurred_at)}</Text>
            </View>

            <Text style={styles.entryActor}>
              {entry.actor_email ?? '—'}
              {entry.actor_role ? ` · ${entry.actor_role}` : ''}
            </Text>

            {entry.entity_type ? (
              <Text style={styles.entryEntity}>{entry.entity_type}</Text>
            ) : null}
            {entry.note ? <Text style={styles.entryNote}>{entry.note}</Text> : null}
          </Card>
        ))
      )}

      {hasMore && entries.length > 0 ? (
        <SecondaryButton
          label={loadingMore ? mn.common.loading : mn.audit.loadMore}
          onPress={() => void load('more', offset + 50, action)}
          disabled={loadingMore}
        />
      ) : null}
    </ScrollView>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },

  notice: { backgroundColor: colors.infoBg, borderRadius: radius.md, padding: spacing.md },
  noticeText: { ...typography.caption, color: colors.info },

  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  chipTextSelected: { color: colors.onPrimary },

  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryAction: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  entryTime: { ...typography.caption, color: colors.textMuted },
  entryActor: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  entryEntity: { ...typography.caption, color: colors.textFaint },
  entryNote: { ...typography.caption, color: colors.textMuted },
});
