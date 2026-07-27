/**
 * Screen 5 — Төлөвлөгөө боловсруулах (Weekly plan builder)
 *
 * A step-by-step "add visit" form rather than a free-form editor, because it
 * is used one-handed, outdoors, on a phone. Every step is chips or a picker;
 * the only typing is the objective and an optional time.
 *
 * Brand choices are limited to the representative's own assignments — that is
 * what makes two reps visiting the same doctor meaningful.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import {
  addPlannedVisit,
  cancelPlannedVisit,
  fetchDoctorOptionsForClinic,
  fetchPlanVisits,
  fetchPlanForWeek,
  isPlanEditable,
  submitPlan,
  type PlannedVisitDetail,
} from '../../src/data/planning';
import { fetchBrands, fetchClinics, fetchMyBrandAssignments } from '../../src/data/repositories';
import type { Brand, Clinic } from '../../src/data/types';
import {
  Card,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { planStatusMn, weekdayFullMn } from '../../src/lib/i18n/enums';
import { addDays, formatDateMn } from '../../src/lib/datetime';
import { colors, radius, spacing, touch, typography } from '../../src/theme';
import { getSupabase } from '../../src/lib/supabase';

interface PlanHeader {
  id: string;
  week_start_date: string;
  status: string;
  review_comment: string | null;
}

export default function PlanBuilderScreen() {
  const { id: planId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useSession();

  const [plan, setPlan] = useState<PlanHeader | null>(null);
  const [editable, setEditable] = useState(false);
  const [visits, setVisits] = useState<PlannedVisitDetail[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [myBrands, setMyBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // "Add visit" form state
  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [doctorOptions, setDoctorOptions] = useState<
    Array<{ id: string; full_name: string; speciality: string }>
  >([]);
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId || !profile) return;
    setLoading(true);

    const supabase = getSupabase();
    if (!supabase) {
      setError(mn.errors.configMissing);
      setLoading(false);
      return;
    }

    const { data: header, error: headerError } = await supabase
      .from('weekly_plan')
      .select('id, week_start_date, status, review_comment')
      .eq('id', planId)
      .maybeSingle();

    if (headerError || !header) {
      setError(mn.errors.loadFailed);
      setLoading(false);
      return;
    }
    setPlan(header as PlanHeader);

    const [editableResult, visitsResult, clinicsResult, brandsResult, assignmentsResult] =
      await Promise.all([
        isPlanEditable(planId),
        fetchPlanVisits(planId),
        fetchClinics(),
        fetchBrands(),
        fetchMyBrandAssignments(profile.id),
      ]);

    setEditable(Boolean(editableResult.data));
    setVisits(visitsResult.data ?? []);
    setClinics((clinicsResult.data ?? []).filter((c) => c.is_active));

    const assigned = new Set((assignmentsResult.data ?? []).map((a) => a.brand_id));
    setMyBrands((brandsResult.data ?? []).filter((b) => assigned.has(b.id)));

    setError(visitsResult.error ?? clinicsResult.error);
    setLoading(false);
  }, [planId, profile]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const chooseClinic = async (id: string) => {
    setClinicId(id);
    setDoctorIds([]);
    const result = await fetchDoctorOptionsForClinic(id);
    setDoctorOptions(result.data ?? []);
  };

  const resetForm = () => {
    setFormOpen(false);
    setDate(null);
    setClinicId(null);
    setDoctorOptions([]);
    setDoctorIds([]);
    setBrandIds([]);
    setObjective('');
    setTime('');
    setFormError(null);
  };

  const nextOrderFor = (forDate: string): number =>
    visits.filter((v) => v.planned_date.slice(0, 10) === forDate).length + 1;

  const saveVisit = async () => {
    if (!plan || !date) {
      setFormError(mn.planBuilder.errorNoClinic);
      return;
    }
    if (!clinicId) return setFormError(mn.planBuilder.errorNoClinic);
    if (doctorIds.length === 0) return setFormError(mn.planBuilder.errorNoDoctor);
    if (brandIds.length === 0) return setFormError(mn.planBuilder.errorNoBrand);
    if (!objective.trim()) return setFormError(mn.planBuilder.errorNoObjective);

    const trimmedTime = time.trim();
    if (trimmedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmedTime)) {
      return setFormError(mn.planBuilder.errorBadTime);
    }

    setSaving(true);
    setFormError(null);

    const result = await addPlannedVisit({
      planId: plan.id,
      clinicId,
      plannedDate: date,
      plannedOrder: nextOrderFor(date),
      plannedTime: trimmedTime || null,
      objective: objective.trim(),
      doctorIds,
      brandIds,
    });

    setSaving(false);

    if (result.error) {
      // Business rules (e.g. duplicate visit) return a Mongolian message that
      // tells the representative exactly what is wrong. Show it verbatim.
      setFormError(result.error);
      return;
    }

    resetForm();
    await load();
  };

  const confirmSubmit = () => {
    Alert.alert(mn.planBuilder.submit, mn.planBuilder.submitConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.planBuilder.submit,
        onPress: async () => {
          if (!plan) return;
          setSubmitting(true);
          const result = await submitPlan(plan.id);
          setSubmitting(false);

          if (result.error) {
            Alert.alert(mn.common.error, result.error);
            return;
          }
          Alert.alert(mn.app.shortName, mn.planBuilder.submitted);
          await load();
        },
      },
    ]);
  };

  const confirmRemove = (visit: PlannedVisitDetail) => {
    Alert.alert(mn.planBuilder.removeVisit, mn.planBuilder.removeVisitConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.planBuilder.removeVisit,
        style: 'destructive',
        onPress: async () => {
          const result = await cancelPlannedVisit(visit.id);
          if (result.error) Alert.alert(mn.common.error, result.error);
          await load();
        },
      },
    ]);
  };

  const visitsByDate = useMemo(() => {
    const map = new Map<string, PlannedVisitDetail[]>();
    for (const visit of visits) {
      const key = visit.planned_date.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(visit);
      else map.set(key, [visit]);
    }
    return map;
  }, [visits]);

  if (loading) return <LoadingState />;
  if (error || !plan) return <ErrorState message={error ?? mn.common.empty} onRetry={load} />;

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(plan.week_start_date, i));
  const activeVisits = visits.filter(
    (v) => v.status !== 'cancelled_unapproved' && v.status !== 'cancelled_approved',
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.planHeader}>
          <Text style={styles.weekTitle}>
            {formatDateMn(plan.week_start_date)} – {formatDateMn(addDays(plan.week_start_date, 6))}
          </Text>
          <Pill label={planStatusMn[plan.status as keyof typeof planStatusMn] ?? plan.status} />
        </View>
        <Text style={styles.muted}>{mn.week.totalVisits(activeVisits.length)}</Text>

        {!editable ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{mn.planBuilder.notEditable}</Text>
            <Text style={styles.noticeText}>{mn.planBuilder.notEditableHint}</Text>
          </View>
        ) : null}

        {plan.review_comment ? (
          <View style={styles.rejection}>
            <Text style={styles.rejectionLabel}>{mn.week.reviewComment}</Text>
            <Text style={styles.rejectionText}>{plan.review_comment}</Text>
          </View>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {editable ? (
        formOpen ? (
          <Card>
            <Text style={styles.formTitle}>{mn.planBuilder.addVisit}</Text>

            <Text style={styles.step}>{mn.planBuilder.step1}</Text>
            <View style={styles.chipWrap}>
              {weekDates.map((d, index) => (
                <Choice
                  key={d}
                  label={`${weekdayFullMn[index]?.slice(0, 2)} ${formatDateMn(d).slice(5)}`}
                  selected={date === d}
                  onPress={() => setDate(d)}
                />
              ))}
            </View>

            <Text style={styles.step}>{mn.planBuilder.step2}</Text>
            <View style={styles.chipWrap}>
              {clinics.map((clinic) => (
                <Choice
                  key={clinic.id}
                  label={clinic.name}
                  selected={clinicId === clinic.id}
                  onPress={() => void chooseClinic(clinic.id)}
                />
              ))}
            </View>

            {clinicId ? (
              <>
                <Text style={styles.step}>{mn.planBuilder.step3}</Text>
                {doctorOptions.length === 0 ? (
                  <Text style={styles.muted}>{mn.planBuilder.noDoctorsAtClinic}</Text>
                ) : (
                  <View style={styles.chipWrap}>
                    {doctorOptions.map((doctor) => (
                      <Choice
                        key={doctor.id}
                        label={doctor.full_name}
                        selected={doctorIds.includes(doctor.id)}
                        onPress={() =>
                          setDoctorIds((current) =>
                            current.includes(doctor.id)
                              ? current.filter((x) => x !== doctor.id)
                              : [...current, doctor.id],
                          )
                        }
                      />
                    ))}
                  </View>
                )}
              </>
            ) : null}

            <Text style={styles.step}>{mn.planBuilder.step4}</Text>
            <Text style={styles.hint}>{mn.planBuilder.onlyMyBrands}</Text>
            <View style={styles.chipWrap}>
              {myBrands.map((brand) => (
                <Choice
                  key={brand.id}
                  label={brand.name}
                  selected={brandIds.includes(brand.id)}
                  onPress={() =>
                    setBrandIds((current) =>
                      current.includes(brand.id)
                        ? current.filter((x) => x !== brand.id)
                        : [...current, brand.id],
                    )
                  }
                />
              ))}
            </View>

            <Text style={styles.step}>{mn.planBuilder.step5}</Text>
            <LabelledInput
              label={mn.planBuilder.objective}
              placeholder={mn.planBuilder.objectivePlaceholder}
              value={objective}
              onChangeText={setObjective}
              multiline
            />
            <LabelledInput
              label={mn.planBuilder.plannedTime}
              placeholder={mn.planBuilder.plannedTimePlaceholder}
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <PrimaryButton
              label={saving ? mn.planBuilder.saving : mn.planBuilder.save}
              onPress={() => void saveVisit()}
              busy={saving}
            />
            <SecondaryButton label={mn.common.cancel} onPress={resetForm} disabled={saving} />
          </Card>
        ) : (
          <PrimaryButton label={mn.planBuilder.addVisit} onPress={() => setFormOpen(true)} />
        )
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {activeVisits.length === 0 ? (
        <Card>
          <Text style={styles.muted}>{mn.planBuilder.emptyPlan}</Text>
        </Card>
      ) : (
        weekDates
          .filter((d) => (visitsByDate.get(d) ?? []).length > 0)
          .map((d) => {
            const index = weekDates.indexOf(d);
            return (
              <Section key={d} title={`${weekdayFullMn[index]} · ${formatDateMn(d)}`}>
                {(visitsByDate.get(d) ?? []).map((visit) => (
                  <Card key={visit.id}>
                    <View style={styles.visitHeader}>
                      <Text style={styles.visitOrder}>{visit.planned_order}</Text>
                      <View style={styles.visitHeaderText}>
                        <Text style={styles.visitClinic}>{visit.clinic?.name ?? '—'}</Text>
                        {visit.planned_time ? (
                          <Text style={styles.muted}>{visit.planned_time.slice(0, 5)}</Text>
                        ) : null}
                      </View>
                      {visit.status !== 'planned' ? (
                        <Pill label={visit.status} tone="neutral" />
                      ) : null}
                    </View>

                    <Text style={styles.label}>{mn.visitDetail.doctors}</Text>
                    <Text style={styles.value}>
                      {visit.planned_visit_doctor
                        .map((d) => d.doctor?.full_name)
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </Text>

                    <Text style={styles.label}>{mn.visitDetail.brands}</Text>
                    <Text style={styles.value}>
                      {[
                        ...new Set(
                          visit.planned_visit_brand.map((b) => b.brand?.name).filter(Boolean),
                        ),
                      ].join(', ') || '—'}
                    </Text>

                    <Text style={styles.label}>{mn.visitDetail.objective}</Text>
                    <Text style={styles.value}>{visit.objective}</Text>

                    {editable ? (
                      <SecondaryButton
                        label={mn.planBuilder.removeVisit}
                        onPress={() => confirmRemove(visit)}
                      />
                    ) : null}
                  </Card>
                ))}
              </Section>
            );
          })
      )}

      {editable && activeVisits.length > 0 ? (
        <PrimaryButton
          label={submitting ? mn.planBuilder.submitting : mn.planBuilder.submit}
          onPress={confirmSubmit}
          busy={submitting}
        />
      ) : null}
    </ScrollView>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.choicePressed,
      ]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },

  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  weekTitle: { ...typography.heading, color: colors.text, flex: 1 },
  muted: { ...typography.body, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },

  notice: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  noticeTitle: { ...typography.bodyStrong, color: colors.warning },
  noticeText: { ...typography.caption, color: colors.warning },

  rejection: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  rejectionLabel: { ...typography.label, color: colors.danger },
  rejectionText: { ...typography.body, color: colors.danger },

  formTitle: { ...typography.heading, color: colors.text },
  step: { ...typography.label, color: colors.primary, marginTop: spacing.sm },
  formError: { ...typography.body, color: colors.danger, lineHeight: 21 },

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

  visitHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  visitOrder: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
    backgroundColor: colors.primary,
    width: 30,
    height: 30,
    borderRadius: 15,
    textAlign: 'center',
    lineHeight: 30,
    overflow: 'hidden',
  },
  visitHeaderText: { flex: 1 },
  visitClinic: { ...typography.bodyStrong, color: colors.text },

  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },
  value: { ...typography.body, color: colors.text },
});
