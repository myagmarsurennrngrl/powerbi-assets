import React from 'react';
import { Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/state/AuthContext';
import { fetchPublicSettings } from '@/services/api';
import { can } from '@/domain/permissions';
import { env } from '@/config/env';
import { mn } from '@/i18n/mn';
import {
  Badge,
  Button,
  Card,
  Heading,
  Muted,
  Row,
  Screen,
  Title,
} from '@/ui/components';

/** Screen 21 — Тохиргоо. Reachable by every role. */
export default function SettingsScreen() {
  const { profile, signOut } = useAuth();

  // These are the live values the geofence will use in Phase 3. Showing them
  // here means a representative can see the rules rather than guess at them.
  const settings = useQuery({ queryKey: ['public-settings'], queryFn: fetchPublicSettings });

  function confirmSignOut() {
    Alert.alert(mn.auth.signOut, mn.auth.signOutConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      { text: mn.auth.signOut, style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  const value = (key: string) => {
    const v = settings.data?.[key];
    return v === undefined ? '—' : String(v);
  };

  const audioEnabled = settings.data?.feature_audio_recording === true;

  return (
    <>
      <Stack.Screen options={{ title: mn.settings.title }} />
      <Screen>
        <Title>{mn.settings.title}</Title>

        <Card>
          <Heading>{mn.settings.account}</Heading>
          <Row label={mn.admin.fullName} value={profile?.full_name} />
          <Row label={mn.admin.email} value={profile?.email} />
          <Row label={mn.admin.role} value={profile ? mn.roles[profile.role] : '—'} />
          <Row label={mn.admin.employeeCode} value={profile?.employee_code} />
        </Card>

        <Card onPress={() => router.push('/(app)/settings/privacy')}>
          <Heading>{mn.settings.privacy}</Heading>
          <Muted>Апп таны байршлыг хэзээ, яагаад авдаг талаар</Muted>
        </Card>

        <Card onPress={() => router.push('/(app)/settings/sync')}>
          <Heading>{mn.settings.syncStatus}</Heading>
          <Muted>Офлайн бичлэгүүдийн төлөв</Muted>
        </Card>

        {can(profile?.role ?? null, 'audit.read') ? (
          <Card onPress={() => router.push('/(app)/settings/audit')}>
            <Heading>{mn.settings.auditLog}</Heading>
            <Muted>Системд хийгдсэн чухал үйлдлүүдийн бүртгэл</Muted>
          </Card>
        ) : null}

        <Card>
          <Heading>Системийн тохиргоо</Heading>
          <Row label="Анхдагч геофенсийн радиус" value={`${value('default_geofence_radius_m')} м`} />
          <Row label="GPS нарийвчлалын хязгаар" value={`${value('gps_accuracy_threshold_m')} м`} />
          <Row label="Цагтаа эхэлсэн тооцох зөрүү" value={`${value('on_time_tolerance_minutes')} мин`} />
          <Row
            label="Дуу хураах боломж"
            value={audioEnabled ? 'Идэвхтэй' : 'Идэвхгүй (анхдагч)'}
          />
          {!audioEnabled ? <Badge label="Дуу хураалт унтраалттай" tone="success" /> : null}
        </Card>

        <Card>
          <Heading>Апп</Heading>
          <Row label={mn.settings.appVersion} value={env.appVersion} />
          <Row label={mn.settings.server} value={env.supabaseUrl.replace(/^https:\/\//, '')} />
          <Row label="Цагийн бүс" value="Asia/Ulaanbaatar (24 цаг)" />
        </Card>

        <Button label={mn.auth.signOut} onPress={confirmSignOut} variant="danger" />
      </Screen>
    </>
  );
}
