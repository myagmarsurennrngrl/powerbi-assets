import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDoctors, softDeleteDoctor, upsertDoctor, type Doctor } from '@/services/api';
import { doctorSchema, toFieldErrors } from '@/domain/validation';
import { mn } from '@/i18n/mn';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  LoadingState,
  Muted,
  Screen,
  Title,
  Toggle,
} from '@/ui/components';

export default function AdminDoctorsScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);

  const query = useQuery({ queryKey: ['admin-doctors'], queryFn: () => fetchDoctors(true) });

  const refresh = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-doctors'] });
    void queryClient.invalidateQueries({ queryKey: ['doctors'] });
  };

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (editing !== null) {
    return (
      <DoctorForm
        doctor={editing === 'new' ? null : editing}
        onDone={refresh}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const doctors = query.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: mn.doctors.title }} />
      <Screen>
        <Button label={mn.admin.addDoctor} onPress={() => setEditing('new')} />
        {doctors.length === 0 ? <EmptyState message={mn.doctors.empty} /> : null}
        {doctors.map((d) => (
          <Card key={d.id} onPress={() => setEditing(d)}>
            <Heading>{d.full_name}</Heading>
            <Muted>{d.speciality}</Muted>
            {!d.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
          </Card>
        ))}
      </Screen>
    </>
  );
}

function DoctorForm({
  doctor,
  onDone,
  onCancel,
}: {
  doctor: Doctor | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = doctor === null;

  const [code, setCode] = useState(doctor?.code ?? '');
  const [fullName, setFullName] = useState(doctor?.full_name ?? '');
  const [speciality, setSpeciality] = useState(doctor?.speciality ?? '');
  const [phone, setPhone] = useState(doctor?.phone ?? '');
  const [email, setEmail] = useState(doctor?.email ?? '');
  const [notes, setNotes] = useState(doctor?.professional_notes ?? '');
  const [isActive, setIsActive] = useState(doctor?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = doctorSchema.safeParse({
        code,
        full_name: fullName,
        speciality,
        phone,
        email,
        professional_notes: notes,
        is_active: isActive,
      });

      if (!parsed.success) {
        setErrors(toFieldErrors(parsed.error));
        throw new Error('validation');
      }
      setErrors({});

      await upsertDoctor(
        {
          code: parsed.data.code ? parsed.data.code : null,
          full_name: parsed.data.full_name,
          speciality: parsed.data.speciality,
          phone: parsed.data.phone ? parsed.data.phone : null,
          email: parsed.data.email ? parsed.data.email : null,
          professional_notes: parsed.data.professional_notes
            ? parsed.data.professional_notes
            : null,
          is_active: parsed.data.is_active,
        },
        doctor?.id,
      );
    },
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof Error && e.message === 'validation') return;
      setServerError(e instanceof Error ? e.message : mn.common.error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (doctor) await softDeleteDoctor(doctor.id);
    },
    onSuccess: onDone,
    onError: (e) => setServerError(e instanceof Error ? e.message : mn.common.error),
  });

  function confirmDelete() {
    Alert.alert(
      'Устгах',
      'Энэ эмчийг жагсаалтаас хасах уу? Өмнөх уулзалтын түүх хэвээр үлдэнэ.',
      [
        { text: mn.common.cancel, style: 'cancel' },
        { text: 'Устгах', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: isNew ? mn.admin.addDoctor : mn.admin.editDoctor }} />
      <Screen>
        <Title>{isNew ? mn.admin.addDoctor : mn.admin.editDoctor}</Title>

        <Field label="Код" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Field
          label={mn.admin.fullName}
          value={fullName}
          onChangeText={setFullName}
          error={errors.full_name}
        />
        <Field
          label={mn.doctors.speciality}
          value={speciality}
          onChangeText={setSpeciality}
          error={errors.speciality}
        />
        <Field
          label={mn.doctors.phone}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <Field
          label={mn.doctors.email}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        <Field
          label={mn.doctors.professionalNotes}
          value={notes}
          onChangeText={setNotes}
          multiline
          hint={mn.doctors.noPatientData}
          error={errors.professional_notes}
        />

        <Toggle label={mn.admin.activeStatus} value={isActive} onChange={setIsActive} />

        {serverError ? <ErrorState message={serverError} /> : null}

        <Button
          label={mutation.isPending ? mn.common.saving : mn.common.save}
          onPress={() => mutation.mutate()}
          busy={mutation.isPending}
        />
        {!isNew ? <Button label="Устгах" onPress={confirmDelete} variant="danger" /> : null}
        <Button label={mn.common.cancel} onPress={onCancel} variant="secondary" />
      </Screen>
    </>
  );
}
