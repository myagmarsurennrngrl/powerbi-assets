/**
 * Screen 9 — Уулзалт дуусгах (Complete visit form)
 *
 * ROUTE: /report/[visitId] — the parameter is a VISIT id.
 * Deliberately NOT under /visit/[id]/, where [id] means a PLANNED visit id.
 * One parameter name meaning two different things across sibling routes is
 * exactly the ambiguity that produces a hard-to-spot bug.
 *
 * The structured report. Two things shape this screen:
 *
 * 1. IT ADAPTS TO WHAT HAPPENED. If the clinic was closed there is no doctor
 *    to name and no feedback to give, so those sections are not shown at all —
 *    rather than shown and then rejected. The rule set is the server's
 *    (fn_visit_completion_issues); the form just mirrors which fields it will
 *    ask for. See migration 0017 for why this departs from the literal brief.
 *
 * 2. NOTHING IS LOST. Every change autosaves as a draft, so a dropped
 *    connection or a closed app costs nothing. Submission is a separate,
 *    confirmed act — and irreversible, which the confirmation says plainly.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import {
  fetchCompletionIssues,
  fetchVisitReport,
  fetchVisitSelections,
  saveVisitDraft,
  setVisitBrands,
  setVisitDoctors,
  setVisitProducts,
  submitVisitReport,
  type CompletionIssue,
  type VisitReport,
} from '../../src/data/completion';
import { fetchDoctorOptionsForClinic } from '../../src/data/planning';
import { fetchBrands, fetchMyBrandAssignments, fetchProducts } from '../../src/data/repositories';
import type { Brand, Product } from '../../src/data/types';
import {
  Card,
  ErrorState,
  LabelledInput,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import {
  interestLevelMn,
  meetingStatusMn,
  visitOutcomeMn,
} from '../../src/lib/i18n/enums';
import { addDays, formatDurationMn, todayLocal } from '../../src/lib/datetime';
import { colors, radius, spacing, touch, typography } from '../../src/theme';

/** Mirrors the conditional rules in fn_visit_completion_issues. */
function needsDoctorDetail(meetingStatus: string | null): boolean {
  return meetingStatus === 'doctor_met';
}
function needsBrands(meetingStatus: string | null): boolean {
  return meetingStatus === 'doctor_met' || meetingStatus === 'met_clinic_staff_only';
}

export default function CompleteVisitScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const router = useRouter();
  const { profile } = useSession();

  const [report, setReport] = useState<VisitReport | null>(null);
  const [doctorOptions, setDoctorOptions] = useState<
    Array<{ id: string; full_name: string; speciality: string }>
  >([]);
  const [myBrands, setMyBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);

  const [issues, setIssues] = useState<CompletionIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!visitId || !profile) return;
    setLoading(true);

    const [reportResult, selections, brands, allProducts, assignments] = await Promise.all([
      fetchVisitReport(visitId),
      fetchVisitSelections(visitId),
      fetchBrands(),
      fetchProducts(),
      fetchMyBrandAssignments(profile.id),
    ]);

    if (reportResult.error || !reportResult.data) {
      setError(reportResult.error ?? mn.common.empty);
      setLoading(false);
      return;
    }

    setReport(reportResult.data);
    setDoctorIds(selections.data?.doctorIds ?? []);
    setBrandIds(selections.data?.brandIds ?? []);
    setProductIds(selections.data?.productIds ?? []);

    const assigned = new Set((assignments.data ?? []).map((a) => a.brand_id));
    setMyBrands((brands.data ?? []).filter((b) => assigned.has(b.id)));
    setProducts(allProducts.data ?? []);

    if (reportResult.data.clinic_id) {
      const doctors = await fetchDoctorOptionsForClinic(reportResult.data.clinic_id);
      setDoctorOptions(doctors.data ?? []);
    }

    const issueResult = await fetchCompletionIssues(visitId);
    setIssues(issueResult.data ?? []);

    setLoading(false);
  }, [visitId, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Autosave with a short debounce so typing does not fire a request per key. */
  const patch = useCallback(
    (fields: Partial<VisitReport>) => {
      setReport((current) => (current ? { ...current, ...fields } : current));

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!visitId) return;
        setSaving(true);
        await saveVisitDraft(visitId, fields as never);
        const refreshed = await fetchCompletionIssues(visitId);
        setIssues(refreshed.data ?? []);
        setSaving(false);
      }, 700);
    },
    [visitId],
  );

  const toggleDoctor = async (doctorId: string) => {
    const next = doctorIds.includes(doctorId)
      ? doctorIds.filter((x) => x !== doctorId)
      : [...doctorIds, doctorId];
    setDoctorIds(next);
    if (visitId) {
      await setVisitDoctors(visitId, next);
      const refreshed = await fetchCompletionIssues(visitId);
      setIssues(refreshed.data ?? []);
    }
  };

  const toggleBrand = async (brandId: string) => {
    const next = brandIds.includes(brandId)
      ? brandIds.filter((x) => x !== brandId)
      : [...brandIds, brandId];
    setBrandIds(next);
    if (visitId) {
      await setVisitBrands(visitId, next);
      // Dropping a brand must drop its products too, or the report claims a
      // product was discussed under a brand that was not.
      const stillValid = productIds.filter((pid) =>
        next.includes(products.find((p) => p.id === pid)?.brand_id ?? ''),
      );
      if (stillValid.length !== productIds.length) {
        setProductIds(stillValid);
        await setVisitProducts(visitId, stillValid);
      }
      const refreshed = await fetchCompletionIssues(visitId);
      setIssues(refreshed.data ?? []);
    }
  };

  const toggleProduct = async (productId: string) => {
    const next = productIds.includes(productId)
      ? productIds.filter((x) => x !== productId)
      : [...productIds, productId];
    setProductIds(next);
    if (visitId) await setVisitProducts(visitId, next);
  };

  const confirmSubmit = () => {
    Alert.alert(mn.completeVisit.submit, mn.completeVisit.submitConfirm, [
      { text: mn.common.cancel, style: 'cancel' },
      {
        text: mn.completeVisit.submit,
        onPress: async () => {
          if (!visitId) return;
          setSubmitting(true);
          // Flush any pending autosave before submitting.
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (report) {
            await saveVisitDraft(visitId, {
              objective: report.objective,
              meeting_status: report.meeting_status,
              outcome: report.outcome,
              interest_level: report.interest_level,
              doctor_feedback: report.doctor_feedback,
              rep_summary: report.rep_summary,
              next_action: report.next_action,
              samples_provided: report.samples_provided,
              materials_provided: report.materials_provided,
              follow_up_required: report.follow_up_required,
              follow_up_date: report.follow_up_date,
            } as never);
          }

          const result = await submitVisitReport(visitId);
          setSubmitting(false);

          if (result.error) {
            Alert.alert(mn.common.error, result.error);
            const refreshed = await fetchCompletionIssues(visitId);
            setIssues(refreshed.data ?? []);
            return;
          }

          Alert.alert(mn.completeVisit.title, mn.completeVisit.submitted);
          router.replace('/(tabs)/today');
        },
      },
    ]);
  };

  if (loading) return <LoadingState />;
  if (error || !report) return <ErrorState message={error ?? mn.common.empty} onRetry={load} />;

  // A submitted report is not editable — by anyone, including its author.
  if (!report.is_draft) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.submittedTitle}>{mn.completeVisit.submitted}</Text>
          <Text style={styles.muted}>{mn.history.readOnly}</Text>
        </Card>
      </ScrollView>
    );
  }

  const showDoctorDetail = needsDoctorDetail(report.meeting_status);
  const showBrands = needsBrands(report.meeting_status);
  const availableProducts = products.filter((p) => brandIds.includes(p.brand_id));
  const canSubmit = issues.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.clinicName}>{report.clinic?.name ?? '—'}</Text>
        <Text style={styles.muted}>
          {mn.activeVisit.elapsed}: {formatDurationMn(report.duration_seconds)}
        </Text>
        {report.completed_at_server === null ? (
          <Text style={styles.blocked}>{mn.completeVisit.notCheckedOut}</Text>
        ) : null}
      </Card>

      {/* 1 — what happened. Everything below adapts to this answer. */}
      <Section title={mn.completeVisit.meetingStatus}>
        <View style={styles.chipWrap}>
          {Object.entries(meetingStatusMn).map(([code, label]) => (
            <Choice
              key={code}
              label={label}
              selected={report.meeting_status === code}
              onPress={() => patch({ meeting_status: code })}
            />
          ))}
        </View>
      </Section>

      {showDoctorDetail ? (
        <Section title={mn.completeVisit.doctorsMet}>
          <View style={styles.chipWrap}>
            {doctorOptions.map((doctor) => (
              <Choice
                key={doctor.id}
                label={doctor.full_name}
                selected={doctorIds.includes(doctor.id)}
                onPress={() => void toggleDoctor(doctor.id)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {showBrands ? (
        <Section title={mn.completeVisit.brandsDiscussed}>
          <Text style={styles.hint}>{mn.completeVisit.onlyMyBrands}</Text>
          <View style={styles.chipWrap}>
            {myBrands.map((brand) => (
              <Choice
                key={brand.id}
                label={brand.name}
                selected={brandIds.includes(brand.id)}
                onPress={() => void toggleBrand(brand.id)}
              />
            ))}
          </View>

          {availableProducts.length > 0 ? (
            <>
              <Text style={styles.subLabel}>
                {mn.completeVisit.productsDiscussed} ({mn.common.optional})
              </Text>
              <View style={styles.chipWrap}>
                {availableProducts.map((product) => (
                  <Choice
                    key={product.id}
                    label={product.name}
                    selected={productIds.includes(product.id)}
                    onPress={() => void toggleProduct(product.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title={mn.completeVisit.objective}>
        <LabelledInput
          label={mn.completeVisit.objective}
          value={report.objective ?? ''}
          onChangeText={(text) => patch({ objective: text })}
          multiline
        />
      </Section>

      <Section title={mn.completeVisit.outcome}>
        <View style={styles.chipWrap}>
          {Object.entries(visitOutcomeMn).map(([code, label]) => (
            <Choice
              key={code}
              label={label}
              selected={report.outcome === code}
              onPress={() => patch({ outcome: code })}
            />
          ))}
        </View>
      </Section>

      {showDoctorDetail ? (
        <>
          <Section title={mn.completeVisit.doctorFeedback}>
            <LabelledInput
              label={mn.completeVisit.doctorFeedback}
              hint={mn.completeVisit.noPatientInfo}
              value={report.doctor_feedback ?? ''}
              onChangeText={(text) => patch({ doctor_feedback: text })}
              multiline
            />
          </Section>

          <Section title={mn.completeVisit.interestLevel}>
            <View style={styles.chipWrap}>
              {Object.entries(interestLevelMn).map(([code, label]) => (
                <Choice
                  key={code}
                  label={label}
                  selected={report.interest_level === code}
                  onPress={() => patch({ interest_level: code })}
                />
              ))}
            </View>
          </Section>
        </>
      ) : null}

      <Section title={mn.completeVisit.samples}>
        <LabelledInput
          label={`${mn.completeVisit.samples} (${mn.common.optional})`}
          value={report.samples_provided ?? ''}
          onChangeText={(text) => patch({ samples_provided: text })}
        />
        <LabelledInput
          label={`${mn.completeVisit.materials} (${mn.common.optional})`}
          value={report.materials_provided ?? ''}
          onChangeText={(text) => patch({ materials_provided: text })}
        />
      </Section>

      <Section title={mn.completeVisit.followUpRequired}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{mn.completeVisit.followUpRequired}</Text>
          <Switch
            value={report.follow_up_required === true}
            onValueChange={(value) =>
              patch({
                follow_up_required: value,
                // A sensible default two weeks out; the rep can change it.
                follow_up_date: value ? (report.follow_up_date ?? addDays(todayLocal(), 14)) : null,
              })
            }
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
          />
        </View>

        {report.follow_up_required ? (
          <View style={styles.chipWrap}>
            {[7, 14, 21, 30].map((days) => {
              const date = addDays(todayLocal(), days);
              return (
                <Choice
                  key={days}
                  label={`${days} хоног (${date.slice(5)})`}
                  selected={report.follow_up_date === date}
                  onPress={() => patch({ follow_up_date: date })}
                />
              );
            })}
          </View>
        ) : null}
      </Section>

      <Section title={mn.completeVisit.nextAction}>
        <LabelledInput
          label={mn.completeVisit.nextAction}
          value={report.next_action ?? ''}
          onChangeText={(text) => patch({ next_action: text })}
          multiline
        />
      </Section>

      <Section title={mn.completeVisit.repSummary}>
        <LabelledInput
          label={mn.completeVisit.repSummary}
          hint={mn.completeVisit.noPatientInfo}
          value={report.rep_summary ?? ''}
          onChangeText={(text) => patch({ rep_summary: text })}
          multiline
        />
      </Section>

      {/* What is still missing — named, in Mongolian, from the server's rules. */}
      {issues.length > 0 ? (
        <View style={styles.issues}>
          <Text style={styles.issuesTitle}>{mn.completeVisit.incomplete}</Text>
          {issues.map((issue) => (
            <Text key={`${issue.field}:${issue.issue}`} style={styles.issueItem}>
              • {mn.completeVisit.fieldNames[issue.field] ?? issue.field}
              {issue.issue === 'in_the_past' ? ' (өнгөрсөн огноо)' : ''}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.autosave}>
        {saving ? mn.completeVisit.savingDraft : mn.completeVisit.draftSaved}
      </Text>

      <PrimaryButton
        label={submitting ? mn.completeVisit.submitting : mn.completeVisit.submit}
        onPress={confirmSubmit}
        disabled={!canSubmit}
        busy={submitting}
      />
      <SecondaryButton label={mn.common.back} onPress={() => router.back()} />
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

  clinicName: { ...typography.heading, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  subLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm },
  blocked: { ...typography.body, color: colors.danger, fontWeight: '600' },
  submittedTitle: { ...typography.heading, color: colors.success },

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

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.button,
  },
  switchLabel: { ...typography.body, color: colors.text, flex: 1 },

  issues: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  issuesTitle: { ...typography.bodyStrong, color: colors.warning },
  issueItem: { ...typography.body, color: colors.warning },

  autosave: { ...typography.caption, color: colors.textFaint, textAlign: 'center' },
});
