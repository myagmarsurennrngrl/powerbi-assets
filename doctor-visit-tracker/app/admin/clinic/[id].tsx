/**
 * Screen 20a — Эмнэлэг үүсгэх / засах (Create or edit a clinic)
 *
 * `id` is either a clinic id or the literal `new`.
 *
 * This is the single most operationally important administrative screen in the
 * application. The coordinates and the allowed radius decide whether a
 * representative standing at the clinic can start a visit at all. Get them
 * wrong and the KPI records a missed visit for someone who was there.
 *
 * Two safeguards are visible here:
 *
 *  - a warning (not a block) if the coordinates fall outside Mongolia, which is
 *    what a swapped latitude/longitude looks like. It is a warning because the
 *    bounding box is a heuristic and a real clinic must never be un-saveable
 *    because of one;
 *  - the radius hint states what the number actually means in the field, since
 *    "150" is meaningless without "a normal clinic; 300–500 for a hospital
 *    campus".
 *
 * The 30–2000 m limits, the null-island rejection and the duplicate-name rule
 * are all CHECK constraints in the database. This screen only explains them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../../src/lib/auth';
import {
  archiveClinic,
  createClinic,
  fetchClinicById,
  updateClinic,
} from '../../../src/data/admin';

import {
  ActiveToggle,
  Card,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../../src/components/ui';
import { mn } from '../../../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../../../src/theme';

/** Mongolia's bounding box — the same one fn_clinic_coordinates_plausible uses. */
function plausible(lat: number, lon: number): boolean {
  return lat >= 41 && lat <= 52.5 && lon >= 87 && lon <= 120;
}

export default function ClinicEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { isAdmin } = useSession();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [clinicType, setClinicType] = useState('');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusM, setRadiusM] = useState('150');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const result = await fetchClinicById(id);
    if (result.error || !result.data) {
      setLoadError(result.error ?? mn.common.empty);
    } else {
      const c = result.data;
      setCode(c.code);
      setName(c.name);
      setClinicType(c.clinic_type);
      setDistrict(c.district);
      setAddress(c.address);
      setLatitude(String(c.latitude));
      setLongitude(String(c.longitude));
      setRadiusM(String(c.geofence_radius_m));
      setContactPhone(c.contact_phone ?? '');
      setNotes(c.notes ?? '');
      setIsActive(c.is_active);
      setLoadError(null);
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isAdmin) return <EmptyState label={mn.admin.adminOnly} />;
  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  const lat = Number(latitude);
  const lon = Number(longitude);
  const coordinatesEntered = latitude.trim() !== '' && longitude.trim() !== '';
  const coordinatesNumeric = coordinatesEntered && Number.isFinite(lat) && Number.isFinite(lon);
  const showImplausible = coordinatesNumeric && !plausible(lat, lon);

  async function handleSave() {
    setFormError(null);

    if (!name.trim()) return setFormError(mn.admin.errorNameRequired);
    if (!code.trim()) return setFormError(mn.admin.errorCodeRequired);
    if (!district.trim()) return setFormError(mn.admin.errorDistrictRequired);
    if (!address.trim()) return setFormError(mn.admin.errorAddressRequired);
    if (!coordinatesNumeric) return setFormError(mn.admin.errorCoordinatesRequired);

    const r = Number(radiusM);
    if (!Number.isFinite(r) || r < 30 || r > 2000) {
      return setFormError(mn.admin.errorRadiusRange);
    }

    const payload = {
      code: code.trim(),
      name: name.trim(),
      clinic_type: clinicType.trim() || '—',
      district: district.trim(),
      address: address.trim(),
      latitude: lat,
      longitude: lon,
      geofence_radius_m: Math.round(r),
      contact_phone: contactPhone.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
    };

    setBusy(true);
    const result = isNew ? await createClinic(payload) : await updateClinic(id, payload);
    setBusy(false);

    if (result.error) return setFormError(result.error);

    Alert.alert(mn.admin.editClinic, mn.admin.saved, [
      { text: mn.common.close, onPress: () => router.back() },
    ]);
  }

  function confirmArchive() {
    if (isActive) {
      Alert.alert(mn.admin.archive, mn.admin.archiveNeedsInactive);
      return;
    }
    Alert.alert(mn.admin.archive, mn.admin.archiveConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.admin.archive,
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const result = await archiveClinic(id);
          setBusy(false);
          // The refusal comes from the database trigger and is shown verbatim:
          // "this clinic has N planned visits" is exactly what the
          // administrator needs to know.
          if (result.error) Alert.alert(mn.common.error, result.error);
          else router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title={mn.admin.editClinic}>
        <Card>
          <LabelledInput
            label={mn.admin.code}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
          />
          <LabelledInput label={mn.admin.clinicName} value={name} onChangeText={setName} />
          <LabelledInput
            label={mn.admin.clinicType}
            value={clinicType}
            onChangeText={setClinicType}
          />
          <LabelledInput label={mn.admin.district} value={district} onChangeText={setDistrict} />
          <LabelledInput
            label={mn.admin.address}
            value={address}
            onChangeText={setAddress}
            multiline
          />
        </Card>
      </Section>

      <Section title={mn.admin.radius}>
        <Card>
          <Text style={styles.hint}>{mn.admin.coordinatesHint}</Text>

          <LabelledInput
            label={mn.admin.latitude}
            value={latitude}
            onChangeText={setLatitude}
            keyboardType="numbers-and-punctuation"
            placeholder="47.918000"
          />
          <LabelledInput
            label={mn.admin.longitude}
            value={longitude}
            onChangeText={setLongitude}
            keyboardType="numbers-and-punctuation"
            placeholder="106.917000"
          />

          {showImplausible ? (
            <View style={styles.warn}>
              <Text style={styles.warnText}>{mn.admin.coordinatesImplausible}</Text>
            </View>
          ) : null}

          <LabelledInput
            label={mn.admin.radius}
            hint={mn.admin.radiusHint}
            value={radiusM}
            onChangeText={setRadiusM}
            keyboardType="number-pad"
          />
        </Card>
      </Section>

      <Section title={mn.admin.notes}>
        <Card>
          <LabelledInput
            label={`${mn.admin.contactPhone} (${mn.common.optional})`}
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
          />
          <LabelledInput
            label={`${mn.admin.notes} (${mn.common.optional})`}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <ActiveToggle value={isActive} onChange={setIsActive} />
        </Card>
      </Section>

      {formError ? <ErrorState message={formError} /> : null}

      <PrimaryButton
        label={busy ? mn.admin.saving : mn.admin.save}
        onPress={() => void handleSave()}
        disabled={busy}
      />

      {!isNew ? (
        <Section title={mn.admin.archive}>
          <Card>
            <Text style={styles.hint}>{mn.admin.archiveHint}</Text>
            <SecondaryButton
              label={mn.admin.archive}
              onPress={confirmArchive}
              disabled={busy}
            />
          </Card>
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  warn: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warnText: { ...typography.caption, color: colors.warning, lineHeight: 18 },
});
