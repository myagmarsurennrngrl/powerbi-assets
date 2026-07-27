import React from 'react';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchAuditLog } from '@/services/api';
import { useAuth } from '@/state/AuthContext';
import { can } from '@/domain/permissions';
import { mn } from '@/i18n/mn';
import { formatDateTime } from '@/i18n/datetime';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Muted,
  Row,
  Screen,
  Title,
} from '@/ui/components';

/** Screen 23 — Аудит бүртгэл. Managers and administrators. Read-only, always. */
export default function AuditScreen() {
  const { profile } = useAuth();
  const allowed = can(profile?.role ?? null, 'audit.read');

  const query = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => fetchAuditLog(100),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <>
        <Stack.Screen options={{ title: mn.settings.auditLog }} />
        <EmptyState message="Танд энэ хэсгийг үзэх эрх байхгүй." />
      </>
    );
  }

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const entries = query.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: mn.settings.auditLog }} />
      <Screen>
        <Title>{mn.settings.auditLog}</Title>
        <Muted>Сүүлийн 100 бичлэг. Аудит бүртгэлийг хэн ч засах, устгах боломжгүй.</Muted>
        {entries.length === 0 ? <EmptyState message={mn.common.noData} /> : null}
        {entries.map((e) => (
          <Card key={e.id}>
            <Row label="Огноо" value={formatDateTime(e.occurred_at)} />
            <Row label="Үйлдэл" value={e.action} emphasis />
            <Row label="Обьект" value={e.entity_type} />
            <Row label="Хэрэглэгч" value={e.actor_email ?? 'систем'} />
            <Row label="Эрх" value={e.actor_role ? mn.roles[e.actor_role] : '—'} />
          </Card>
        ))}
      </Screen>
    </>
  );
}
