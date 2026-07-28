/**
 * Screen 22 — Синк төлөв (Sync status)
 *
 * What has not reached the server yet, and why.
 *
 * This screen exists because of one failure mode: a representative writes six
 * visit reports in a building with no signal, sees them saved, and assumes
 * they are filed. The queue makes that safe, but only if the person can *see*
 * the queue. An invisible queue and a lost afternoon look identical.
 *
 * Blocked items are separated from waiting ones and show the server's own
 * message. "Waiting for a connection" and "the server refused this" need
 * different actions from the person, so they must not look the same.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSync } from '../src/lib/offline/SyncProvider';
import { discard, retryNow } from '../src/lib/offline/outboxStore';
import { storageStats } from '../src/lib/offline/db';
import { describeAgeMn } from '../src/domain/cachePolicy';
import type { OutboxOperation } from '../src/domain/outbox';
import {
  Card,
  EmptyState,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../src/components/ui';
import { mn } from '../src/lib/i18n/mn';
import { formatDateTimeMn } from '../src/lib/datetime';
import { colors, radius, spacing, typography } from '../src/theme';

export default function SyncScreen() {
  const { online, summary, operations, syncing, sync, refresh } = useSync();
  const [stats, setStats] = useState<{ cacheRows: number; outboxRows: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await storageStats());
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats, operations.length]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const waiting = operations.filter((op) => op.status !== 'blocked');
  const blocked = operations.filter((op) => op.status === 'blocked');

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    await loadStats();
    setRefreshing(false);
  }

  async function onRetry(op: OutboxOperation) {
    await retryNow(op);
    await sync();
  }

  function onDiscard(op: OutboxOperation) {
    Alert.alert(mn.sync.discard, mn.sync.discardConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.sync.discard,
        style: 'destructive',
        onPress: async () => {
          await discard(op.id);
          await refresh();
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <Card style={online ? styles.onlineCard : styles.offlineCard}>
        <View style={styles.statusRow}>
          <Pill
            label={online ? mn.sync.online : mn.sync.offline}
            tone={online ? 'success' : 'warning'}
          />
          {summary.total === 0 ? (
            <Pill label={mn.sync.allSynced} tone="success" />
          ) : (
            <Pill label={mn.sync.queueCount(summary.total)} tone="warning" />
          )}
        </View>

        {summary.oldestPendingAt !== null ? (
          <Text style={styles.muted}>
            {mn.sync.oldestPending(describeAgeMn(summary.oldestPendingAt, Date.now()))}
          </Text>
        ) : null}

        <PrimaryButton
          label={syncing ? mn.sync.syncing : mn.sync.syncNow}
          onPress={() => void sync()}
          disabled={syncing || summary.total === 0}
          busy={syncing}
        />
      </Card>

      {summary.total === 0 ? (
        <EmptyState label={`${mn.sync.allSynced}\n${mn.sync.allSyncedHint}`} />
      ) : null}

      {waiting.length > 0 ? (
        <Section title={mn.sync.queueTitle}>
          {waiting.map((op) => (
            <QueueRow key={op.id} op={op} />
          ))}
        </Section>
      ) : null}

      {blocked.length > 0 ? (
        <Section title={mn.sync.blockedTitle}>
          <View style={styles.blockedNotice}>
            <Text style={styles.blockedNoticeText}>{mn.sync.blockedHint}</Text>
          </View>
          {blocked.map((op) => (
            <QueueRow
              key={op.id}
              op={op}
              onRetry={() => void onRetry(op)}
              onDiscard={() => onDiscard(op)}
            />
          ))}
        </Section>
      ) : null}

      <Section title={mn.sync.storage}>
        <Card>
          <Text style={styles.muted}>
            {stats ? mn.sync.storageRows(stats.cacheRows, stats.outboxRows) : mn.common.loading}
          </Text>
          <Text style={styles.hint}>{mn.settings.locationPolicy}</Text>
        </Card>
      </Section>
    </ScrollView>
  );
}

function QueueRow({
  op,
  onRetry,
  onDiscard,
}: {
  op: OutboxOperation;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const statusLabel =
    op.status === 'blocked'
      ? mn.sync.failed
      : op.status === 'sending'
        ? mn.sync.sending
        : mn.sync.pending;

  return (
    <Card style={op.status === 'blocked' ? styles.blockedCard : undefined}>
      <View style={styles.rowHeader}>
        <Text style={styles.kind}>{mn.sync.kinds[op.kind] ?? op.kind}</Text>
        <Pill label={statusLabel} tone={op.status === 'blocked' ? 'danger' : 'warning'} />
      </View>

      <Text style={styles.meta}>{formatDateTimeMn(new Date(op.createdAt).toISOString())}</Text>
      {op.attempts > 0 ? <Text style={styles.meta}>{mn.sync.attempts(op.attempts)}</Text> : null}

      {op.lastError ? <Text style={styles.error}>{op.lastError}</Text> : null}

      {onRetry ? (
        <View style={styles.actions}>
          <SecondaryButton label={mn.sync.retryOne} onPress={onRetry} />
          <SecondaryButton label={mn.sync.discard} onPress={onDiscard ?? (() => {})} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  onlineCard: { borderColor: colors.success, borderWidth: 1 },
  offlineCard: { borderColor: colors.warning, borderWidth: 1 },

  statusRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  muted: { ...typography.body, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textFaint, lineHeight: 18 },

  blockedNotice: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md },
  blockedNoticeText: { ...typography.caption, color: colors.danger, lineHeight: 18 },
  blockedCard: { borderColor: colors.danger, borderWidth: 1 },

  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  kind: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  meta: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.caption, color: colors.danger, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
