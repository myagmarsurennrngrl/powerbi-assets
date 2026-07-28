/**
 * Shared doctor visit history with the five filters from the brief.
 *
 * ACCEPTANCE CRITERION 10. Every authorised representative reads the same
 * history, written by all their colleagues — that is the collaboration this
 * whole project exists to enable. It is strictly READ-ONLY here: the original
 * text is never editable, and corrections appear beneath their visit as
 * separate, attributed addenda.
 *
 * Managers and administrators additionally get an «Залруулга нэмэх» action,
 * which adds a new row and still never touches the original.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../lib/auth';
import {
  addAddendum,
  fetchAddenda,
  fetchDoctorHistory,
  type Addendum,
  type HistoryEntry,
  type HistoryFilters,
} from '../data/completion';
import { useAsyncData } from '../data/useAsyncData';
import {
  Card,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from './ui';
import { mn } from '../lib/i18n/mn';
import {
  interestLevelMn,
  meetingStatusMn,
  translateEnum,
  visitOutcomeMn,
} from '../lib/i18n/enums';
import { addDays, formatDateMn, formatDateTimeMn, formatDurationMn, todayLocal } from '../lib/datetime';
import { colors, radius, spacing, touch, typography } from '../theme';

type Period = 'all' | '30' | '90' | '365';

export function DoctorHistory({ doctorId }: { doctorId: string }) {
  const { isManager } = useSession();

  const [period, setPeriod] = useState<Period>('all');
  const [repId, setRepId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const [addendumFor, setAddendumFor] = useState<string | null>(null);
  const [addendumText, setAddendumText] = useState('');
  const [addendumReason, setAddendumReason] = useState('');
  const [savingAddendum, setSavingAddendum] = useState(false);

  /**
   * Server-side filters that genuinely narrow the query: date, rep, clinic,
   * outcome. Brand is filtered locally — see below.
   */
  const serverFilters: HistoryFilters = useMemo(() => {
    const fromDate =
      period === 'all' ? null : addDays(todayLocal(), -Number(period));
    return { fromDate, repId, clinicId, outcome };
  }, [period, repId, clinicId, outcome]);

  const loader = useCallback(async () => {
    const history = await fetchDoctorHistory(doctorId, serverFilters);
    if (history.error) return { data: null, error: history.error };

    const entries = history.data ?? [];
    const addenda = await fetchAddenda(entries.map((e) => e.visit_id));

    return { data: { entries, addenda: addenda.data ?? [] }, error: null };
  }, [doctorId, serverFilters]);

  const { data, loading, error, reload } = useAsyncData(loader, [doctorId, serverFilters]);

  const entries = data?.entries ?? [];

  // Brand is filtered here rather than on the server because the history rows
  // already carry their brand names, and doing it locally keeps the filter
  // instant while the rep scrolls. The server-side p_brand_id parameter exists
  // and is tested; it is simply not needed for a list this size.
  const visible = useMemo(
    () => (brandName ? entries.filter((e) => e.brand_names.includes(brandName)) : entries),
    [entries, brandName],
  );

  const addendaByVisit = useMemo(() => {
    const map = new Map<string, Addendum[]>();
    for (const addendum of data?.addenda ?? []) {
      const list = map.get(addendum.visit_id);
      if (list) list.push(addendum);
      else map.set(addendum.visit_id, [addendum]);
    }
    return map;
  }, [data?.addenda]);

  const reps = useMemo(
    () => dedupe(entries.map((e) => ({ id: e.rep_id, label: e.rep_name }))),
    [entries],
  );
  const clinics = useMemo(
    () => dedupe(entries.map((e) => ({ id: e.clinic_id, label: e.clinic_name }))),
    [entries],
  );
  const brands = useMemo(
    () => [...new Set(entries.flatMap((e) => e.brand_names))].sort(),
    [entries],
  );
  const outcomes = useMemo(
    () => [...new Set(entries.map((e) => e.outcome).filter(Boolean))] as string[],
    [entries],
  );

  const anyFilter = period !== 'all' || repId || brandName || clinicId || outcome;

  const clearFilters = () => {
    setPeriod('all');
    setRepId(null);
    setBrandName(null);
    setClinicId(null);
    setOutcome(null);
  };

  const saveAddendum = async () => {
    if (!addendumFor) return;
    if (!addendumText.trim() || !addendumReason.trim()) {
      Alert.alert(mn.common.error, mn.history.addendumText);
      return;
    }

    setSavingAddendum(true);
    const result = await addAddendum(addendumFor, addendumText.trim(), addendumReason.trim());
    setSavingAddendum(false);

    if (result.error) {
      Alert.alert(mn.common.error, result.error);
      return;
    }

    setAddendumFor(null);
    setAddendumText('');
    setAddendumReason('');
    Alert.alert(mn.history.addendumTitle, mn.history.addendumSaved);
    reload();
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <View style={styles.container}>
      {/* ---------------- filters ---------------- */}
      <View style={styles.filters}>
        <FilterRow
          label={mn.history.filterPeriod}
          options={[
            { id: 'all', label: mn.history.periodAll },
            { id: '30', label: mn.history.period30 },
            { id: '90', label: mn.history.period90 },
            { id: '365', label: mn.history.period365 },
          ]}
          selected={period}
          onSelect={(id) => setPeriod(id as Period)}
          allowClear={false}
        />

        {reps.length > 1 ? (
          <FilterRow
            label={mn.history.filterRep}
            options={reps}
            selected={repId}
            onSelect={setRepId}
          />
        ) : null}

        {brands.length > 1 ? (
          <FilterRow
            label={mn.history.filterBrand}
            options={brands.map((b) => ({ id: b, label: b }))}
            selected={brandName}
            onSelect={setBrandName}
          />
        ) : null}

        {clinics.length > 1 ? (
          <FilterRow
            label={mn.history.filterClinic}
            options={clinics}
            selected={clinicId}
            onSelect={setClinicId}
          />
        ) : null}

        {outcomes.length > 1 ? (
          <FilterRow
            label={mn.history.filterOutcome}
            options={outcomes.map((o) => ({
              id: o,
              label: translateEnum(visitOutcomeMn, o),
            }))}
            selected={outcome}
            onSelect={setOutcome}
          />
        ) : null}

        <View style={styles.filterFooter}>
          <Text style={styles.count}>{mn.history.count(visible.length)}</Text>
          {anyFilter ? (
            <Pressable onPress={clearFilters} accessibilityRole="button">
              <Text style={styles.clear}>{mn.history.clearFilters}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ---------------- entries ---------------- */}
      {visible.length === 0 ? (
        <EmptyState label={anyFilter ? mn.history.emptyFiltered : mn.history.empty} />
      ) : (
        visible.map((entry) => (
          <Card key={entry.visit_id}>
            <View style={styles.entryHeader}>
              <Text style={styles.entryDate}>{formatDateMn(entry.visit_date)}</Text>
              <Pill
                label={translateEnum(meetingStatusMn, entry.meeting_status)}
                tone={entry.meeting_status === 'doctor_met' ? 'success' : 'neutral'}
              />
            </View>

            <Text style={styles.entryRep}>{mn.history.visitedBy(entry.rep_name)}</Text>
            <Text style={styles.entryMeta}>
              {entry.clinic_name} · {formatDurationMn(entry.duration_seconds)}
            </Text>

            {entry.brand_names.length > 0 ? (
              <View style={styles.chipRow}>
                {entry.brand_names.map((brand) => (
                  <View key={brand} style={styles.chip}>
                    <Text style={styles.chipText}>{brand}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {entry.product_names.length > 0 ? (
              <Field label={mn.completeVisit.productsDiscussed} value={entry.product_names.join(', ')} />
            ) : null}

            <Field label={mn.completeVisit.outcome} value={translateEnum(visitOutcomeMn, entry.outcome)} />

            {entry.interest_level ? (
              <Field
                label={mn.completeVisit.interestLevel}
                value={translateEnum(interestLevelMn, entry.interest_level)}
              />
            ) : null}

            {entry.doctor_feedback ? (
              <Field label={mn.completeVisit.doctorFeedback} value={entry.doctor_feedback} />
            ) : null}

            {entry.rep_summary ? (
              <Field label={mn.completeVisit.repSummary} value={entry.rep_summary} />
            ) : null}

            {entry.next_action ? (
              <Field label={mn.completeVisit.nextAction} value={entry.next_action} />
            ) : null}

            {entry.follow_up_required && entry.follow_up_date ? (
              <Pill
                label={`${mn.completeVisit.followUpDate}: ${formatDateMn(entry.follow_up_date)}`}
                tone="info"
              />
            ) : null}

            {/* Corrections, shown WITH the original rather than replacing it. */}
            {(addendaByVisit.get(entry.visit_id) ?? []).map((addendum) => (
              <View key={addendum.id} style={styles.addendum}>
                <Text style={styles.addendumLabel}>
                  {mn.history.addendumTitle} · {addendum.author_email ?? '—'} ·{' '}
                  {formatDateTimeMn(addendum.created_at)}
                </Text>
                <Text style={styles.addendumText}>{addendum.correction_text}</Text>
                <Text style={styles.addendumReason}>
                  {mn.history.addendumReason}: {addendum.reason}
                </Text>
              </View>
            ))}

            {isManager ? (
              <SecondaryButton
                label={mn.history.addAddendum}
                onPress={() => setAddendumFor(entry.visit_id)}
              />
            ) : null}
          </Card>
        ))
      )}

      <Text style={styles.readOnly}>{mn.history.readOnly}</Text>

      {/* ---------------- addendum composer ---------------- */}
      <Modal
        visible={addendumFor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setAddendumFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{mn.history.addAddendum}</Text>
              <Text style={styles.modalNote}>{mn.history.addendumNote}</Text>

              <LabelledInput
                label={mn.history.addendumText}
                value={addendumText}
                onChangeText={setAddendumText}
                multiline
              />
              <LabelledInput
                label={mn.history.addendumReason}
                value={addendumReason}
                onChangeText={setAddendumReason}
              />

              <PrimaryButton
                label={mn.history.addendumSave}
                onPress={() => void saveAddendum()}
                busy={savingAddendum}
              />
              <SecondaryButton
                label={mn.common.cancel}
                onPress={() => setAddendumFor(null)}
                disabled={savingAddendum}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onSelect,
  allowClear = true,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  allowClear?: boolean;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.filterChips}>
          {allowClear ? (
            <FilterChip
              label={mn.common.all}
              selected={selected === null}
              onPress={() => onSelect(null)}
            />
          ) : null}
          {options.map((option) => (
            <FilterChip
              key={option.id}
              label={option.label}
              selected={selected === option.id}
              onPress={() => onSelect(selected === option.id && allowClear ? null : option.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function FilterChip({
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
      style={[styles.filterChip, selected && styles.filterChipSelected]}
    >
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function dedupe(items: Array<{ id: string; label: string }>): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item.label);
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },

  filters: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  filterGroup: { gap: 4 },
  filterLabel: { ...typography.label, color: colors.textMuted },
  filterChips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  filterChipTextSelected: { color: colors.onPrimary },
  filterFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: touch.row,
  },
  count: { ...typography.caption, color: colors.textMuted },
  clear: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  entryDate: { ...typography.bodyStrong, color: colors.text },
  entryRep: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  entryMeta: { ...typography.caption, color: colors.textMuted },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  chipText: { ...typography.caption, color: colors.primaryDark, fontWeight: '600' },

  field: { gap: 2, paddingTop: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textMuted },
  fieldValue: { ...typography.body, color: colors.text },

  addendum: {
    backgroundColor: colors.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: 2,
    marginTop: spacing.sm,
  },
  addendumLabel: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  addendumText: { ...typography.body, color: colors.text },
  addendumReason: { ...typography.caption, color: colors.textMuted },

  readOnly: { ...typography.caption, color: colors.textFaint, textAlign: 'center' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center' },
  modalScroll: { padding: spacing.lg },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: { ...typography.heading, color: colors.text },
  modalNote: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
});
