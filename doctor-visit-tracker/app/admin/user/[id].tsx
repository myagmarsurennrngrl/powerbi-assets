/**
 * Screen 19a — Хэрэглэгч үүсгэх / засах (Create or edit a user)
 *
 * `id` is either an app_user id or the literal `new`.
 *
 * Two rules are visible in the interface rather than only in the database:
 *
 *  - The email address cannot be changed after creation. It is the link to the
 *    login, so editing it would silently detach the person from their account.
 *    The field is shown, disabled, with the reason.
 *  - Brands can only be held by representatives, so that section disappears for
 *    a manager or an administrator.
 *
 * Every refusal shown here comes from the database, not from this screen. The
 * disabled states are for usability; the rules are enforced in migration 0023.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../../src/lib/auth';
import { useAsyncData } from '../../../src/data/useAsyncData';
import { fetchBrands } from '../../../src/data/repositories';
import {
  assignBrand,
  createUser,
  endAssignment,
  fetchAdminUsers,
  fetchAssignments,
  setUserActive,
  setUserRole,
  updateUser,
  type AdminAssignment,
  type AdminUserRow,
} from '../../../src/data/admin';
import type { Brand, UserRole } from '../../../src/data/types';
import {
  Card,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../../src/components/ui';
import { mn } from '../../../src/lib/i18n/mn';
import { userRoleMn } from '../../../src/lib/i18n/enums';
import { colors, radius, spacing, typography } from '../../../src/theme';

const ROLES: UserRole[] = ['representative', 'manager', 'administrator'];

export default function UserEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { isAdmin, profile } = useSession();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('representative');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loader = useCallback(async () => {
    const [users, brands] = await Promise.all([fetchAdminUsers(), fetchBrands()]);
    if (users.error) return { data: null, error: users.error };

    const all = users.data ?? [];
    const user = isNew ? null : (all.find((u) => u.id === id) ?? null);

    const assignments =
      user && user.role === 'representative'
        ? await fetchAssignments(user.id)
        : { data: [] as AdminAssignment[], error: null };

    return {
      data: {
        user,
        all,
        brands: (brands.data ?? []) as Brand[],
        assignments: assignments.data ?? [],
      },
      error: null,
    };
  }, [id, isNew]);

  const { data, loading, error, reload } = useAsyncData(loader, [id, isNew]);

  // Fill the form once, from the loaded row. Re-filling on every reload would
  // discard whatever the administrator is in the middle of typing.
  useFocusEffect(
    useCallback(() => {
      if (loaded || !data) return;
      if (data.user) {
        setFullName(data.user.full_name);
        setEmail(data.user.email);
        setPhone(data.user.phone ?? '');
        setRole(data.user.role);
        setManagerId(data.user.manager_id);
      }
      setLoaded(true);
    }, [data, loaded]),
  );

  const managerOptions = useMemo(
    () =>
      (data?.all ?? []).filter(
        (u) => u.is_active && u.id !== id && (u.role === 'manager' || u.role === 'administrator'),
      ),
    [data, id],
  );

  const unassignedBrands = useMemo(() => {
    const held = new Set((data?.assignments ?? []).map((a) => a.brand_id));
    return (data?.brands ?? []).filter((b) => !held.has(b.id));
  }, [data]);

  if (!isAdmin) return <EmptyState label={mn.admin.adminOnly} />;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!isNew && !data?.user) return <EmptyState label={mn.common.empty} />;

  const user: AdminUserRow | null = data?.user ?? null;
  const isSelf = user?.id === profile?.id;

  async function handleSave() {
    setFormError(null);

    if (!fullName.trim()) {
      setFormError(mn.admin.errorNameRequired);
      return;
    }

    setBusy(true);
    const result = isNew
      ? await createUser({
          email: email.trim(),
          full_name: fullName.trim(),
          role,
          manager_id: managerId,
          phone: phone.trim() || null,
        })
      : await updateUser({
          id: user!.id,
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          manager_id: managerId,
        });
    setBusy(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    if (isNew) {
      Alert.alert(mn.admin.createUser, mn.admin.neverSignedInHint, [
        { text: mn.common.close, onPress: () => router.back() },
      ]);
    } else {
      Alert.alert(mn.admin.editUser, mn.admin.saved);
      reload();
    }
  }

  async function handleRoleChange(next: UserRole) {
    if (!user || next === user.role) {
      setRole(next);
      return;
    }
    setBusy(true);
    const result = await setUserRole(user.id, next);
    setBusy(false);

    if (result.error) {
      // The role selector must not show a state the database refused.
      setRole(user.role);
      Alert.alert(mn.common.error, result.error);
      return;
    }
    setRole(next);
    reload();
  }

  function confirmDeactivate() {
    if (!user) return;
    Alert.alert(mn.admin.deactivate, mn.admin.deactivateConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.admin.confirmYes,
        style: 'destructive',
        onPress: () => void applyActive(false),
      },
    ]);
  }

  async function applyActive(active: boolean) {
    if (!user) return;
    setBusy(true);
    const result = await setUserActive(user.id, active, null);
    setBusy(false);

    if (result.error) {
      Alert.alert(mn.common.error, result.error);
      return;
    }
    reload();
  }

  async function handleAssign(brandId: string) {
    if (!user) return;
    setBusy(true);
    const result = await assignBrand(user.id, brandId);
    setBusy(false);
    if (result.error) Alert.alert(mn.common.error, result.error);
    else reload();
  }

  function confirmRemoveBrand(assignmentId: string) {
    Alert.alert(mn.admin.removeBrand, mn.admin.removeBrandConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.admin.removeBrand,
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const result = await endAssignment(assignmentId);
          setBusy(false);
          if (result.error) Alert.alert(mn.common.error, result.error);
          else reload();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title={isNew ? mn.admin.createUser : mn.admin.editUser}>
        <Card>
          <LabelledInput
            label={mn.admin.fullName}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          {isNew ? (
            <LabelledInput
              label={mn.admin.email}
              hint={mn.admin.emailHint}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder={mn.auth.emailPlaceholder}
            />
          ) : (
            <View style={styles.lockedField}>
              <Text style={styles.fieldLabel}>{mn.admin.email}</Text>
              <Text style={styles.lockedValue}>{user!.email}</Text>
              <Text style={styles.hint}>{mn.admin.emailLockedHint}</Text>
            </View>
          )}

          <LabelledInput
            label={`${mn.admin.phone} (${mn.common.optional})`}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </Card>
      </Section>

      <Section title={mn.admin.role}>
        <Card>
          <View style={styles.optionRow}>
            {ROLES.map((option) => (
              <Choice
                key={option}
                label={userRoleMn[option]}
                selected={role === option}
                disabled={busy || isSelf}
                onPress={() => (isNew ? setRole(option) : void handleRoleChange(option))}
              />
            ))}
          </View>
          {isSelf ? <Text style={styles.hint}>{mn.admin.adminOnly}</Text> : null}
        </Card>
      </Section>

      <Section title={mn.admin.manager}>
        <Card>
          <View style={styles.optionRow}>
            <Choice
              label={mn.admin.noManager}
              selected={managerId === null}
              disabled={busy}
              onPress={() => setManagerId(null)}
            />
            {managerOptions.map((m) => (
              <Choice
                key={m.id}
                label={m.full_name}
                selected={managerId === m.id}
                disabled={busy}
                onPress={() => setManagerId(m.id)}
              />
            ))}
          </View>
        </Card>
      </Section>

      {formError ? <ErrorState message={formError} /> : null}

      <PrimaryButton
        label={busy ? mn.admin.saving : mn.admin.save}
        onPress={() => void handleSave()}
        disabled={busy}
      />

      {/* Brand assignments exist only for representatives, and only once the
          account exists — there is nothing to attach them to before that. */}
      {!isNew && user!.role === 'representative' ? (
        <Section title={mn.admin.brands}>
          <Card>
            <Text style={styles.hint}>{mn.admin.brandsHint}</Text>

            {(data?.assignments ?? []).length === 0 ? (
              <Text style={styles.muted}>{mn.admin.noBrands}</Text>
            ) : (
              (data?.assignments ?? []).map((a) => (
                <View key={a.id} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName}>{a.brand_name}</Text>
                  <Pressable
                    onPress={() => confirmRemoveBrand(a.id)}
                    accessibilityRole="button"
                    disabled={busy}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeText}>{mn.admin.removeBrand}</Text>
                  </Pressable>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={styles.fieldLabel}>{mn.admin.addBrand}</Text>
            {unassignedBrands.length === 0 ? (
              <Text style={styles.muted}>{mn.admin.noBrandsToAdd}</Text>
            ) : (
              <View style={styles.optionRow}>
                {unassignedBrands.map((b) => (
                  <Choice
                    key={b.id}
                    label={b.name}
                    selected={false}
                    disabled={busy}
                    onPress={() => void handleAssign(b.id)}
                  />
                ))}
              </View>
            )}
          </Card>
        </Section>
      ) : null}

      {!isNew ? (
        <Section title={user!.is_active ? mn.admin.deactivate : mn.admin.activate}>
          <Card>
            <View style={styles.statusRow}>
              <Pill
                label={user!.is_active ? mn.common.active : mn.common.inactive}
                tone={user!.is_active ? 'success' : 'neutral'}
              />
              {!user!.has_signed_in ? (
                <Pill label={mn.admin.neverSignedIn} tone="warning" />
              ) : null}
            </View>

            {!user!.has_signed_in ? (
              <Text style={styles.hint}>{mn.admin.neverSignedInHint}</Text>
            ) : null}

            {user!.is_active ? (
              <SecondaryButton
                label={mn.admin.deactivate}
                onPress={confirmDeactivate}
                disabled={busy || isSelf}
              />
            ) : (
              <SecondaryButton
                label={mn.admin.activate}
                onPress={() => void applyActive(true)}
                disabled={busy}
              />
            )}
          </Card>
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Choice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[styles.choice, selected && styles.choiceSelected, disabled && styles.choiceDisabled]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  fieldLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  muted: { ...typography.body, color: colors.textMuted },

  lockedField: { gap: 4 },
  lockedValue: {
    ...typography.body,
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    paddingHorizontal: spacing.md,
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceDisabled: { opacity: 0.45 },
  choiceText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  choiceTextSelected: { color: colors.onPrimary },

  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  assignmentName: { ...typography.body, color: colors.text, flex: 1 },
  removeButton: { paddingHorizontal: spacing.sm, minHeight: 38, justifyContent: 'center' },
  removeText: { ...typography.caption, color: colors.danger, fontWeight: '600' },

  statusRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
