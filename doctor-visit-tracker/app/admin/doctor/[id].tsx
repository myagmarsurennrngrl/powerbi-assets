/**
 * Screen 20b — Эмч үүсгэх / засах (Create or edit a doctor)
 *
 * `id` is either a doctor id or the literal `new`.
 *
 * PRIVACY: there is no patient-related field here and there never will be. The
 * professional notes field carries an explicit warning, because a free-text box
 * next to a doctor's name is exactly where patient information would otherwise
 * end up. See docs/07-risks.md P2 and P4.
 *
 * When creating, the name is checked against existing doctors with PostgreSQL's
 * trigram similarity. Two clinics spelling the same person's name slightly
 * differently is the usual way this table rots, and the visit history then
 * splits across two records that look like two people.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../../src/lib/auth';
import {
  archiveDoctor,
  createDoctor,
  fetchDoctorById,
  findSimilarDoctors,
  updateDoctor,
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

export default function DoctorEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { isAdmin } = useSession();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [speciality, setSpeciality] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [similar, setSimilar] = useState<{ id: string; full_name: string; speciality: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const result = await fetchDoctorById(id);
    if (result.error || !result.data) {
      setLoadError(result.error ?? mn.common.empty);
    } else {
      const d = result.data;
      setCode(d.code);
      setFullName(d.full_name);
      setSpeciality(d.speciality);
      setPhone(d.phone ?? '');
      setEmail(d.email ?? '');
      setNotes(d.professional_notes ?? '');
      setIsActive(d.is_active);
      setLoadError(null);
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  // Duplicate check while creating. Debounced so it does not fire on every
  // keystroke, and only once the name is long enough to be meaningful.
  useEffect(() => {
    if (!isNew || fullName.trim().length < 4) {
      setSimilar([]);
      return;
    }
    const handle = setTimeout(async () => {
      const result = await findSimilarDoctors(fullName.trim());
      setSimilar(result.data ?? []);
    }, 500);
    return () => clearTimeout(handle);
  }, [fullName, isNew]);

  if (!isAdmin) return <EmptyState label={mn.admin.adminOnly} />;
  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  async function handleSave() {
    setFormError(null);

    if (!fullName.trim()) return setFormError(mn.admin.errorNameRequired);
    if (!code.trim()) return setFormError(mn.admin.errorCodeRequired);
    if (!speciality.trim()) return setFormError(mn.admin.errorSpecialityRequired);

    const payload = {
      code: code.trim(),
      full_name: fullName.trim(),
      speciality: speciality.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      professional_notes: notes.trim() || null,
      is_active: isActive,
    };

    setBusy(true);
    const result = isNew ? await createDoctor(payload) : await updateDoctor(id, payload);
    setBusy(false);

    if (result.error) return setFormError(result.error);

    Alert.alert(mn.admin.editDoctor, mn.admin.saved, [
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
          const result = await archiveDoctor(id);
          setBusy(false);
          if (result.error) Alert.alert(mn.common.error, result.error);
          else router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title={mn.admin.editDoctor}>
        <Card>
          <LabelledInput
            label={mn.admin.code}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
          />
          <LabelledInput
            label={mn.admin.doctorName}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          {similar.length > 0 ? (
            <View style={styles.warn}>
              <Text style={styles.warnTitle}>{mn.admin.similarDoctors}</Text>
              {similar.map((d) => (
                <Text key={d.id} style={styles.warnText}>
                  • {d.full_name} — {d.speciality}
                </Text>
              ))}
            </View>
          ) : null}

          <LabelledInput
            label={mn.admin.speciality}
            value={speciality}
            onChangeText={setSpeciality}
          />
        </Card>
      </Section>

      <Section title={mn.admin.notes}>
        <Card>
          <LabelledInput
            label={`${mn.admin.phone} (${mn.common.optional})`}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <LabelledInput
            label={`${mn.admin.doctorEmail} (${mn.common.optional})`}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <LabelledInput
            label={`${mn.admin.professionalNotes} (${mn.common.optional})`}
            hint={mn.admin.professionalNotesHint}
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
            <SecondaryButton label={mn.admin.archive} onPress={confirmArchive} disabled={busy} />
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
  warn: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  warnTitle: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  warnText: { ...typography.caption, color: colors.warning },
});
