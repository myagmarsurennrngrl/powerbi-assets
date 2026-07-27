import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, fetchUsers, updateUser, type AppUserRow } from '@/services/api';
import { toFieldErrors, userSchema } from '@/domain/validation';
import { useAuth } from '@/state/AuthContext';
import { mn } from '@/i18n/mn';
import { formatDateTime } from '@/i18n/datetime';
import { spacing } from '@/theme/tokens';
import type { Role } from '@/domain/permissions';
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  LoadingState,
  Muted,
  Row,
  Screen,
  Title,
  Toggle,
} from '@/ui/components';

/** Screen 19 — Хэрэглэгчийн удирдлага. Administrators only. */
export default function UsersScreen() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AppUserRow | 'new' | null>(null);

  const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const users = query.data ?? [];

  if (editing !== null) {
    return (
      <UserForm
        user={editing === 'new' ? null : editing}
        currentUserId={profile?.id ?? ''}
        onDone={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['users'] });
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <Screen>
      <Title>{mn.admin.usersTitle}</Title>
      <Button label={mn.admin.addUser} onPress={() => setEditing('new')} />

      {users.length === 0 ? <EmptyState message={mn.common.noData} /> : null}

      {users.map((u) => (
        <Card key={u.id} onPress={() => setEditing(u)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Heading>{u.full_name}</Heading>
            {!u.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
          </View>
          <Muted>{u.email}</Muted>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
            <Badge label={mn.roles[u.role]} tone="info" />
            {u.employee_code ? <Badge label={u.employee_code} /> : null}
            {u.auth_user_id === null ? <Badge label="Нэвтэрч ороогүй" tone="warning" /> : null}
          </View>
          {u.last_login_at ? (
            <Muted>{`Сүүлд нэвтэрсэн: ${formatDateTime(u.last_login_at)}`}</Muted>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const ROLE_OPTIONS: readonly { value: Role; label: string }[] = [
  { value: 'representative', label: mn.roles.representative },
  { value: 'manager', label: mn.roles.manager },
  { value: 'administrator', label: mn.roles.administrator },
];

function UserForm({
  user,
  currentUserId,
  onDone,
  onCancel,
}: {
  user: AppUserRow | null;
  currentUserId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = user === null;
  const isSelf = user?.id === currentUserId;

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [employeeCode, setEmployeeCode] = useState(user?.employee_code ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'representative');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = userSchema.safeParse({
        full_name: fullName,
        email,
        employee_code: employeeCode,
        role,
        phone,
        is_active: isActive,
      });

      if (!parsed.success) {
        setErrors(toFieldErrors(parsed.error));
        throw new Error('validation');
      }
      setErrors({});

      const payload = {
        full_name: parsed.data.full_name,
        role: parsed.data.role,
        employee_code: parsed.data.employee_code ? parsed.data.employee_code : null,
        phone: parsed.data.phone ? parsed.data.phone : null,
        is_active: parsed.data.is_active,
      };

      if (isNew) {
        // The e-mail cannot be changed later: it is the key the identity
        // provider links to, so changing it would orphan the account.
        await createUser({ ...payload, email: parsed.data.email });
      } else {
        await updateUser(user.id, payload);
      }
    },
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof Error && e.message === 'validation') return;
      setServerError(e instanceof Error ? e.message : mn.common.error);
    },
  });

  function confirmDeactivate() {
    Alert.alert(mn.admin.deactivate, mn.admin.deactivateConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.admin.deactivate,
        style: 'destructive',
        onPress: () => {
          setIsActive(false);
          mutation.mutate();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Title>{isNew ? mn.admin.addUser : mn.admin.editUser}</Title>

      <Field
        label={mn.admin.fullName}
        value={fullName}
        onChangeText={setFullName}
        error={errors.full_name}
      />

      <Field
        label={mn.admin.email}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={isNew}
        hint={
          isNew
            ? 'Зөвхөн батлагдсан байгууллагын домэйн байна.'
            : 'И-мэйл хаягийг үүсгэсний дараа өөрчлөх боломжгүй.'
        }
        error={errors.email}
      />

      <Field
        label={mn.admin.employeeCode}
        value={employeeCode}
        onChangeText={setEmployeeCode}
        autoCapitalize="characters"
        error={errors.employee_code}
      />

      <ChipGroup
        label={mn.admin.role}
        options={ROLE_OPTIONS}
        value={role}
        onChange={setRole}
      />
      {isSelf ? <Muted>{mn.admin.cannotChangeOwnRole}</Muted> : null}

      <Field
        label={mn.admin.phone}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        error={errors.phone}
      />

      <Toggle label={mn.admin.activeStatus} value={isActive} onChange={setIsActive} />

      {user ? (
        <Card>
          <Row label="ID" value={user.id} />
          <Row
            label="Нэвтэрсэн эсэх"
            value={user.auth_user_id ? mn.common.yes : mn.common.no}
          />
        </Card>
      ) : null}

      {serverError ? <ErrorState message={serverError} /> : null}

      <Button
        label={mutation.isPending ? mn.common.saving : mn.common.save}
        onPress={() => mutation.mutate()}
        busy={mutation.isPending}
      />

      {!isNew && isActive && !isSelf ? (
        <Button label={mn.admin.deactivate} onPress={confirmDeactivate} variant="danger" />
      ) : null}

      <Button label={mn.common.cancel} onPress={onCancel} variant="secondary" />
    </Screen>
  );
}
