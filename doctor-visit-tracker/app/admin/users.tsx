/**
 * Screen 19 — Хэрэглэгчийн удирдлага (User management)
 *
 * Administrators only. The list is intentionally blunt about two things a
 * spreadsheet of staff never shows:
 *
 *  - who has never signed in (their account exists but is not linked to a
 *    login yet — the usual reason for "it says my account is not active");
 *  - who is inactive, kept in the list rather than hidden, because their
 *    historical visits still carry their name.
 *
 * Nobody is ever deleted. There is no delete button because the database
 * grants no DELETE on app_user to anyone.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchAdminUsers, type AdminUserRow } from '../../src/data/admin';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  PrimaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { userRoleMn } from '../../src/lib/i18n/enums';
import { colors, radius, spacing, typography } from '../../src/theme';

export default function UserManagementScreen() {
  const { isAdmin } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(
    useCallback(() => fetchAdminUsers(), []),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const { active, inactive } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (u: AdminUserRow) =>
      !needle ||
      u.full_name.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle);

    const rows = (data ?? []).filter(matches);
    return {
      active: rows.filter((u) => u.is_active),
      inactive: rows.filter((u) => !u.is_active),
    };
  }, [data, search]);

  // The database returns nothing to a non-administrator anyway; this only
  // avoids showing an empty screen with no explanation.
  if (!isAdmin) return <EmptyState label={mn.admin.adminOnly} />;
  if (loading) return <LoadingState />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      <PrimaryButton
        label={mn.admin.newUser}
        onPress={() => router.push('/admin/user/new')}
      />

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={mn.admin.searchUser}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={mn.admin.searchUser}
        style={styles.search}
      />

      <Section title={`${mn.admin.activeUsers} (${active.length})`}>
        {active.length === 0 ? (
          <EmptyState label={mn.admin.noUsers} />
        ) : (
          active.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onPress={() => router.push(`/admin/user/${user.id}`)}
            />
          ))
        )}
      </Section>

      {inactive.length > 0 ? (
        <Section title={`${mn.admin.inactiveUsers} (${inactive.length})`}>
          {inactive.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onPress={() => router.push(`/admin/user/${user.id}`)}
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function UserRow({ user, onPress }: { user: AdminUserRow; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={user.is_active ? undefined : styles.inactiveCard}>
        <View style={styles.rowHeader}>
          <Text style={styles.name}>{user.full_name}</Text>
          <Pill
            label={userRoleMn[user.role]}
            tone={user.role === 'representative' ? 'info' : 'success'}
          />
        </View>

        <Text style={styles.email}>{user.email}</Text>

        {user.manager_name ? (
          <Text style={styles.meta}>{mn.admin.reportsTo(user.manager_name)}</Text>
        ) : null}

        {user.brand_names ? <Text style={styles.meta}>{user.brand_names}</Text> : null}

        <View style={styles.badgeRow}>
          {!user.is_active ? <Pill label={mn.common.inactive} tone="neutral" /> : null}
          {!user.has_signed_in ? <Pill label={mn.admin.neverSignedIn} tone="warning" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    ...typography.body,
    color: colors.text,
  },

  inactiveCard: { opacity: 0.6 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  email: { ...typography.caption, color: colors.primary },
  meta: { ...typography.caption, color: colors.textMuted },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
