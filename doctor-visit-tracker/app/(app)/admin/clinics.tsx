import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchClinics,
  softDeleteClinic,
  upsertClinic,
  type Clinic,
  type ClinicType,
} from '@/services/api';
import { clinicSchema, isInsideMongolia, toFieldErrors } from '@/domain/validation';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
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
  Screen,
  Title,
  Toggle,
} from '@/ui/components';

const TYPE_OPTIONS: readonly { value: ClinicType; label: string }[] = [
  { value: 'public_hospital', label: mn.clinics.types.public_hospital },
  { value: 'private_hospital', label: mn.clinics.types.private_hospital },
  { value: 'clinic', label: mn.clinics.types.clinic },
  { value: 'dermatology_center', label: mn.clinics.types.dermatology_center },
  { value: 'pharmacy_chain', label: mn.clinics.types.pharmacy_chain },
  { value: 'other', label: mn.clinics.types.other },
];

export default function AdminClinicsScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Clinic | 'new' | null>(null);

  const query = useQuery({ queryKey: ['admin-clinics'], queryFn: () => fetchClinics(true) });

  const refresh = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-clinics'] });
    void queryClient.invalidateQueries({ queryKey: ['clinics'] });
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
      <ClinicForm
        clinic={editing === 'new' ? null : editing}
        onDone={refresh}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const clinics = query.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: mn.clinics.title }} />
      <Screen>
        <Button label={mn.admin.addClinic} onPress={() => setEditing('new')} />
        {clinics.length === 0 ? <EmptyState message={mn.clinics.empty} /> : null}
        {clinics.map((c) => (
          <Card key={c.id} onPress={() => setEditing(c)}>
            <Heading>{c.name}</Heading>
            <Muted>{`${c.district} · ${mn.clinics.types[c.clinic_type]}`}</Muted>
            <Muted>{c.address}</Muted>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <Badge label={`${c.geofence_radius_m} м`} tone="info" />
              {!c.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
            </View>
          </Card>
        ))}
      </Screen>
    </>
  );
}

function ClinicForm({
  clinic,
  onDone,
  onCancel,
}: {
  clinic: Clinic | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = clinic === null;

  const [code, setCode] = useState(clinic?.code ?? '');
  const [name, setName] = useState(clinic?.name ?? '');
  const [type, setType] = useState<ClinicType>(clinic?.clinic_type ?? 'clinic');
  const [district, setDistrict] = useState(clinic?.district ?? '');
  const [address, setAddress] = useState(clinic?.address ?? '');
  const [latitude, setLatitude] = useState(clinic ? String(clinic.latitude) : '');
  const [longitude, setLongitude] = useState(clinic ? String(clinic.longitude) : '');
  const [radius, setRadius] = useState(String(clinic?.geofence_radius_m ?? 150));
  const [phone, setPhone] = useState(clinic?.contact_phone ?? '');
  const [notes, setNotes] = useState(clinic?.notes ?? '');
  const [isActive, setIsActive] = useState(clinic?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const latNum = Number.parseFloat(latitude);
  const lngNum = Number.parseFloat(longitude);
  const coordsOutsideMongolia =
    Number.isFinite(latNum) && Number.isFinite(lngNum) && !isInsideMongolia(latNum, lngNum);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = clinicSchema.safeParse({
        code,
        name,
        clinic_type: type,
        district,
        address,
        latitude: Number.parseFloat(latitude),
        longitude: Number.parseFloat(longitude),
        geofence_radius_m: Number.parseInt(radius, 10),
        contact_phone: phone,
        notes,
        is_active: isActive,
      });

      if (!parsed.success) {
        setErrors(toFieldErrors(parsed.error));
        throw new Error('validation');
      }
      setErrors({});

      await upsertClinic(
        {
          code: parsed.data.code ? parsed.data.code : null,
          name: parsed.data.name,
          clinic_type: parsed.data.clinic_type,
          district: parsed.data.district,
          address: parsed.data.address,
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          geofence_radius_m: parsed.data.geofence_radius_m,
          contact_phone: parsed.data.contact_phone ? parsed.data.contact_phone : null,
          notes: parsed.data.notes ? parsed.data.notes : null,
          is_active: parsed.data.is_active,
        },
        clinic?.id,
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
      if (clinic) await softDeleteClinic(clinic.id);
    },
    onSuccess: onDone,
    onError: (e) => setServerError(e instanceof Error ? e.message : mn.common.error),
  });

  function confirmDelete() {
    Alert.alert(
      'Устгах',
      'Энэ эмнэлгийг жагсаалтаас хасах уу? Өмнөх уулзалтын түүх хэвээр үлдэнэ.',
      [
        { text: mn.common.cancel, style: 'cancel' },
        { text: 'Устгах', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: isNew ? mn.admin.addClinic : mn.admin.editClinic }} />
      <Screen>
        <Title>{isNew ? mn.admin.addClinic : mn.admin.editClinic}</Title>

        <Field label="Код" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Field label="Нэр" value={name} onChangeText={setName} error={errors.name} />
        <ChipGroup label={mn.clinics.type} options={TYPE_OPTIONS} value={type} onChange={setType} />
        <Field
          label={mn.clinics.district}
          value={district}
          onChangeText={setDistrict}
          error={errors.district}
        />
        <Field
          label={mn.clinics.address}
          value={address}
          onChangeText={setAddress}
          multiline
          error={errors.address}
        />

        <Field
          label={mn.admin.latitude}
          value={latitude}
          onChangeText={setLatitude}
          keyboardType="numeric"
          hint="Жишээ: 47.918700"
          error={errors.latitude}
        />
        <Field
          label={mn.admin.longitude}
          value={longitude}
          onChangeText={setLongitude}
          keyboardType="numeric"
          hint="Жишээ: 106.917400"
          error={errors.longitude}
        />
        {coordsOutsideMongolia ? (
          <Badge label={mn.admin.coordinatesOutsideMongolia} tone="warning" />
        ) : null}

        <Field
          label={mn.admin.radiusMetres}
          value={radius}
          onChangeText={setRadius}
          keyboardType="number-pad"
          hint={mn.admin.radiusHint}
          error={errors.geofence_radius_m}
        />

        <Field label={mn.clinics.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field
          label={mn.clinics.notes}
          value={notes}
          onChangeText={setNotes}
          multiline
          hint={mn.doctors.noPatientData}
          error={errors.notes}
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
