/**
 * Screen 10 — Чөлөөлөх хүсэлт (Exception request)
 *
 * The pressure valve. Every geofence produces false negatives — wrong
 * coordinates in master data, no GPS inside a concrete hospital, a clinic that
 * closed early — and without a way to say so, the system punishes people for
 * things outside their control and they stop trusting it.
 *
 * TWO THINGS THIS SCREEN IS CAREFUL ABOUT
 * 1. Location is OPTIONAL and opt-in. Someone reporting sick leave from home
 *    has no business sending coordinates. When they ARE at the clinic, the
 *    measured distance is the single most useful fact for the manager, so the
 *    button is offered — never forced.
 * 2. It never pretends to decide. The screen says plainly that only a manager
 *    approves, and warns that some reasons still count towards the KPI even
 *    when approved.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { fetchPlannedVisit, type PlannedVisitDetail } from '../../../src/data/planning';
import { requestException } from '../../../src/data/kpi';
import { readCurrentPosition, type LocationReading } from '../../../src/lib/location';
import { formatDistanceMn, haversineMetres } from '../../../src/domain/geo';
import {
  Card,
  ErrorState,
  LabelledInput,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
} from '../../../src/components/ui';
import { mn } from '../../../src/lib/i18n/mn';
import { exceptionReasonMn } from '../../../src/lib/i18n/enums';
import { formatDateLongMn } from '../../../src/lib/datetime';
import { colors, radius, spacing, touch, typography } from '../../../src/theme';

export default function ExceptionRequestScreen() {
  const { id: plannedVisitId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [visit, setVisit] = useState<PlannedVisitDetail | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [reading, setReading] = useState<LocationReading | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const clientUuid = useRef<string>(Crypto.randomUUID());
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  const load = useCallback(async () => {
    if (!plannedVisitId) return;
    setLoading(true);
    const result = await fetchPlannedVisit(plannedVisitId);
    if (result.error || !result.data) {
      setError(result.error ?? mn.common.empty);
    } else {
      setVisit(result.data);
    }
    setLoading(false);
  }, [plannedVisitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attachLocation = async () => {
    setLocating(true);
    const result = await readCurrentPosition('high');
    setLocating(false);

    if (!result.ok) {
      Alert.alert(mn.exception.attachLocation, mn.today.locationUnavailable);
      return;
    }
    setReading(result.reading);
  };

  const submit = async () => {
    if (!plannedVisitId) return;
    if (!reason) return setFormError(mn.exception.errorNoReason);
    if (!explanation.trim()) return setFormError(mn.exception.errorNoExplanation);

    setSubmitting(true);
    setFormError(null);

    const result = await requestException({
      plannedVisitId,
      reason,
      explanation: explanation.trim(),
      latitude: reading?.latitude ?? null,
      longitude: reading?.longitude ?? null,
      accuracyM: reading?.accuracyM ?? null,
      deviceTimestamp: reading?.deviceTimestamp ?? null,
      clientUuid: clientUuid.current,
      appVersion,
    });

    setSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    Alert.alert(mn.exception.title, mn.exception.submitted);
    router.replace('/(tabs)/today');
  };

  if (loading) return <LoadingState />;
  if (error || !visit) return <ErrorState message={error ?? mn.common.empty} onRetry={load} />;

  const clinic = visit.clinic;
  const distance =
    reading && clinic
      ? haversineMetres(reading, {
          latitude: Number(clinic.latitude),
          longitude: Number(clinic.longitude),
        })
      : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.clinicName}>{clinic?.name ?? '—'}</Text>
        <Text style={styles.muted}>{formatDateLongMn(visit.planned_date)}</Text>
        <Text style={styles.muted}>
          {visit.planned_visit_doctor.map((d) => d.doctor?.full_name).filter(Boolean).join(', ')}
        </Text>
      </Card>

      <Text style={styles.subtitle}>{mn.exception.subtitle}</Text>

      <View style={styles.section}>
        <Text style={styles.label}>{mn.exception.reason}</Text>
        <View style={styles.chipWrap}>
          {Object.entries(exceptionReasonMn).map(([code, label]) => (
            <Pressable
              key={code}
              onPress={() => {
                setReason(code);
                setFormError(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: reason === code }}
              style={({ pressed }) => [
                styles.choice,
                reason === code && styles.choiceSelected,
                pressed && styles.choicePressed,
              ]}
            >
              <Text style={[styles.choiceText, reason === code && styles.choiceTextSelected]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <LabelledInput
        label={mn.exception.explanation}
        placeholder={mn.exception.explanationPlaceholder}
        value={explanation}
        onChangeText={(text) => {
          setExplanation(text);
          setFormError(null);
        }}
        multiline
      />

      {/* Opt-in location. Never required. */}
      <Card>
        <Text style={styles.label}>{mn.exception.attachLocation}</Text>
        <Text style={styles.hint}>{mn.exception.attachLocationHint}</Text>
        {reading && distance !== null ? (
          <Text style={styles.attached}>
            ✓ {mn.exception.locationAttached(formatDistanceMn(distance))}
          </Text>
        ) : null}
        <SecondaryButton
          label={locating ? mn.today.locating : mn.exception.attachLocation}
          onPress={() => void attachLocation()}
          disabled={locating}
        />
      </Card>

      <View style={styles.notice}>
        <Text style={styles.noticeText}>{mn.exception.onlyManagerApproves}</Text>
        <Text style={styles.noticeText}>{mn.exception.kpiWarning}</Text>
      </View>

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton
        label={submitting ? mn.exception.submitting : mn.exception.submit}
        onPress={() => void submit()}
        busy={submitting}
      />
      <SecondaryButton label={mn.common.cancel} onPress={() => router.back()} disabled={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 },

  clinicName: { ...typography.heading, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  subtitle: { ...typography.body, color: colors.text },
  section: { gap: spacing.sm },
  label: { ...typography.label, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  attached: { ...typography.body, color: colors.success, fontWeight: '600' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: touch.button,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choicePressed: { opacity: 0.75 },
  choiceText: { ...typography.body, color: colors.text },
  choiceTextSelected: { color: colors.onPrimary, fontWeight: '600' },

  notice: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  noticeText: { ...typography.caption, color: colors.info, lineHeight: 18 },

  formError: { ...typography.body, color: colors.danger, lineHeight: 21 },
});
