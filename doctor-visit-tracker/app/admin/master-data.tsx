/**
 * Screen 20 — Мастер дата (Master data management)
 *
 * Administrators only. Clinics, doctors, brands and products.
 *
 * The most consequential thing on this screen is the clinic geofence. If a
 * clinic's coordinates or allowed radius are wrong, a representative standing
 * in the right building cannot check in — and the KPI records a missed visit
 * that never happened. The summary therefore calls out how many clinics still
 * carry the untouched default radius, because that is almost always the cause.
 *
 * Nothing is ever deleted. Archiving is a soft delete guarded by a database
 * trigger that refuses to strand planned work.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/auth';
import { useAsyncData } from '../../src/data/useAsyncData';
import {
  fetchBrands,
  fetchClientSettings,
  fetchClinics,
  fetchDoctors,
  fetchProducts,
} from '../../src/data/repositories';
import { fetchMasterDataCounts, saveBrand, saveProduct } from '../../src/data/admin';
import type { Brand, Clinic, Doctor, Product } from '../../src/data/types';
import {
  ActiveToggle,
  Card,
  ChoiceButton,
  EmptyState,
  ErrorState,
  LabelledInput,
  LoadingState,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Section,
} from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { colors, radius, spacing, typography } from '../../src/theme';

type Tab = 'clinics' | 'doctors' | 'brands' | 'products';

const TABS: { key: Tab; label: string }[] = [
  { key: 'clinics', label: mn.admin.clinics },
  { key: 'doctors', label: mn.admin.doctors },
  { key: 'brands', label: mn.admin.brandsSection },
  { key: 'products', label: mn.admin.products },
];

export default function MasterDataScreen() {
  const { isAdmin } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('clinics');
  const [search, setSearch] = useState('');

  const loader = useCallback(async () => {
    const [counts, clinics, doctors, brands, products, settings] = await Promise.all([
      fetchMasterDataCounts(),
      fetchClinics(),
      fetchDoctors(),
      fetchBrands(),
      fetchProducts(),
      fetchClientSettings(),
    ]);

    const firstError =
      counts.error ?? clinics.error ?? doctors.error ?? brands.error ?? products.error;
    if (firstError) return { data: null, error: firstError };

    // The default radius is a database setting, not a constant in this file —
    // the same value fn_admin_master_data_counts() compares against.
    const defaultRadius = Number(settings.data?.default_geofence_radius_m ?? 150);

    return {
      data: {
        counts: counts.data,
        clinics: clinics.data ?? [],
        doctors: doctors.data ?? [],
        brands: brands.data ?? [],
        products: products.data ?? [],
        defaultRadius: Number.isFinite(defaultRadius) ? defaultRadius : 150,
      },
      error: null,
    };
  }, []);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(loader, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const needle = search.trim().toLowerCase();

  const clinics = useMemo(
    () =>
      (data?.clinics ?? []).filter(
        (c) =>
          !needle ||
          c.name.toLowerCase().includes(needle) ||
          c.district.toLowerCase().includes(needle) ||
          c.code.toLowerCase().includes(needle),
      ),
    [data, needle],
  );

  const doctors = useMemo(
    () =>
      (data?.doctors ?? []).filter(
        (d) =>
          !needle ||
          d.full_name.toLowerCase().includes(needle) ||
          d.speciality.toLowerCase().includes(needle),
      ),
    [data, needle],
  );

  if (!isAdmin) return <EmptyState label={mn.admin.adminOnly} />;
  if (loading) return <LoadingState />;

  const counts = data?.counts;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {counts ? (
        <Section title={mn.admin.counts}>
          <View style={styles.countGrid}>
            <Count label={mn.admin.clinics} value={counts.clinics_active} />
            <Count label={mn.admin.doctors} value={counts.doctors_active} />
            <Count label={mn.admin.brandsSection} value={counts.brands_active} />
            <Count label={mn.admin.products} value={counts.products_active} />
          </View>

          {counts.clinics_default_radius > 0 ? (
            <Card style={styles.warnCard}>
              <Text style={styles.warnTitle}>
                {mn.admin.defaultRadiusCount}: {counts.clinics_default_radius}
              </Text>
              <Text style={styles.warnText}>{mn.admin.defaultRadiusHint}</Text>
            </Card>
          ) : null}
        </Section>
      ) : null}

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabSelected]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextSelected]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'clinics' || tab === 'doctors' ? (
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={mn.admin.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={mn.admin.searchPlaceholder}
          style={styles.search}
        />
      ) : null}

      {tab === 'clinics' ? (
        <>
          <PrimaryButton
            label={mn.admin.newClinic}
            onPress={() => router.push('/admin/clinic/new')}
          />
          {clinics.length === 0 ? (
            <EmptyState label={mn.admin.nothingFound} />
          ) : (
            clinics.map((c) => (
              <ClinicRow
                key={c.id}
                clinic={c}
                defaultRadius={data?.defaultRadius ?? 150}
                onPress={() => router.push(`/admin/clinic/${c.id}`)}
              />
            ))
          )}
        </>
      ) : null}

      {tab === 'doctors' ? (
        <>
          <PrimaryButton
            label={mn.admin.newDoctor}
            onPress={() => router.push('/admin/doctor/new')}
          />
          {doctors.length === 0 ? (
            <EmptyState label={mn.admin.nothingFound} />
          ) : (
            doctors.map((d) => (
              <DoctorRow
                key={d.id}
                doctor={d}
                onPress={() => router.push(`/admin/doctor/${d.id}`)}
              />
            ))
          )}
        </>
      ) : null}

      {tab === 'brands' ? (
        <BrandEditor brands={data?.brands ?? []} onChanged={reload} />
      ) : null}

      {tab === 'products' ? (
        <ProductEditor
          products={data?.products ?? []}
          brands={data?.brands ?? []}
          onChanged={reload}
        />
      ) : null}
    </ScrollView>
  );
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------
function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countBox}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function ClinicRow({
  clinic,
  defaultRadius,
  onPress,
}: {
  clinic: Clinic;
  defaultRadius: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={clinic.is_active ? undefined : styles.dim}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>{clinic.name}</Text>
          <Pill
            label={`${clinic.geofence_radius_m} м`}
            tone={clinic.geofence_radius_m === defaultRadius ? 'warning' : 'info'}
          />
        </View>
        <Text style={styles.rowMeta}>
          {clinic.district} · {clinic.code}
        </Text>
        <Text style={styles.rowFaint}>
          {Number(clinic.latitude).toFixed(5)}, {Number(clinic.longitude).toFixed(5)}
        </Text>
        {!clinic.is_active ? <Pill label={mn.common.inactive} tone="neutral" /> : null}
      </Card>
    </Pressable>
  );
}

function DoctorRow({ doctor, onPress }: { doctor: Doctor; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={doctor.is_active ? undefined : styles.dim}>
        <Text style={styles.rowTitle}>{doctor.full_name}</Text>
        <Text style={styles.rowMeta}>{doctor.speciality}</Text>
        {!doctor.is_active ? <Pill label={mn.common.inactive} tone="neutral" /> : null}
      </Card>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Brands and products are edited inline: three fields each, so a separate
// screen would be more navigation than content.
// -----------------------------------------------------------------------------
function BrandEditor({ brands, onChanged }: { brands: Brand[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function open(brand: Brand | null) {
    setEditing(brand ? brand.id : 'new');
    setCode(brand?.code ?? '');
    setName(brand?.name ?? '');
    setCategory(brand?.category ?? '');
    setIsActive(brand?.is_active ?? true);
    setFormError(null);
  }

  async function save() {
    if (!name.trim()) return setFormError(mn.admin.errorNameRequired);
    if (!code.trim()) return setFormError(mn.admin.errorCodeRequired);

    setBusy(true);
    const result = await saveBrand({
      id: editing === 'new' ? null : editing,
      code: code.trim(),
      name: name.trim(),
      category: category.trim(),
      is_active: isActive,
    });
    setBusy(false);

    if (result.error) return setFormError(result.error);
    setEditing(null);
    onChanged();
  }

  return (
    <>
      <PrimaryButton label={mn.admin.newBrand} onPress={() => open(null)} />

      {editing ? (
        <Card>
          <LabelledInput label={mn.admin.code} value={code} onChangeText={setCode} autoCapitalize="characters" />
          <LabelledInput label={mn.admin.brandName} value={name} onChangeText={setName} />
          <LabelledInput label={mn.admin.category} value={category} onChangeText={setCategory} />
          <ActiveToggle value={isActive} onChange={setIsActive} />
          {formError ? <ErrorState message={formError} /> : null}
          <PrimaryButton
            label={busy ? mn.admin.saving : mn.admin.save}
            onPress={() => void save()}
            disabled={busy}
          />
          <SecondaryButton label={mn.common.cancel} onPress={() => setEditing(null)} />
        </Card>
      ) : null}

      {brands.map((b) => (
        <Pressable key={b.id} onPress={() => open(b)} accessibilityRole="button">
          <Card style={b.is_active ? undefined : styles.dim}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{b.name}</Text>
              <Text style={styles.rowFaint}>{b.code}</Text>
            </View>
            <Text style={styles.rowMeta}>{b.category}</Text>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

function ProductEditor({
  products,
  brands,
  onChanged,
}: {
  products: Product[];
  brands: Brand[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const brandName = useMemo(
    () => new Map(brands.map((b) => [b.id, b.name] as const)),
    [brands],
  );

  function open(product: Product | null) {
    setEditing(product ? product.id : 'new');
    setSku(product?.sku ?? '');
    setName(product?.name ?? '');
    setCategory(product?.category ?? '');
    setBrandId(product?.brand_id ?? null);
    setIsActive(product?.is_active ?? true);
    setFormError(null);
  }

  async function save() {
    if (!name.trim()) return setFormError(mn.admin.errorNameRequired);
    if (!sku.trim()) return setFormError(mn.admin.errorCodeRequired);
    if (!brandId) return setFormError(mn.admin.errorBrandRequired);

    setBusy(true);
    const result = await saveProduct({
      id: editing === 'new' ? null : editing,
      sku: sku.trim(),
      name: name.trim(),
      brand_id: brandId,
      category: category.trim(),
      is_active: isActive,
    });
    setBusy(false);

    if (result.error) return setFormError(result.error);
    setEditing(null);
    onChanged();
  }

  return (
    <>
      <PrimaryButton
        label={mn.admin.newProduct}
        onPress={() => {
          if (brands.length === 0) {
            Alert.alert(mn.common.error, mn.admin.errorBrandRequired);
            return;
          }
          open(null);
        }}
      />

      {editing ? (
        <Card>
          <LabelledInput label={mn.admin.sku} value={sku} onChangeText={setSku} autoCapitalize="characters" />
          <LabelledInput label={mn.admin.productName} value={name} onChangeText={setName} />
          <LabelledInput label={mn.admin.category} value={category} onChangeText={setCategory} />

          <Text style={styles.fieldLabel}>{mn.admin.brandOf}</Text>
          <View style={styles.choiceRow}>
            {brands.map((b) => (
              <ChoiceButton
                key={b.id}
                label={b.name}
                selected={brandId === b.id}
                onPress={() => setBrandId(b.id)}
              />
            ))}
          </View>

          <ActiveToggle value={isActive} onChange={setIsActive} />
          {formError ? <ErrorState message={formError} /> : null}
          <PrimaryButton
            label={busy ? mn.admin.saving : mn.admin.save}
            onPress={() => void save()}
            disabled={busy}
          />
          <SecondaryButton label={mn.common.cancel} onPress={() => setEditing(null)} />
        </Card>
      ) : null}

      {products.map((p) => (
        <Pressable key={p.id} onPress={() => open(p)} accessibilityRole="button">
          <Card style={p.is_active ? undefined : styles.dim}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{p.name}</Text>
              <Text style={styles.rowFaint}>{p.sku}</Text>
            </View>
            <Text style={styles.rowMeta}>
              {brandName.get(p.brand_id) ?? '—'} · {p.category}
            </Text>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  countGrid: { flexDirection: 'row', gap: spacing.sm },
  countBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  countValue: { ...typography.heading, color: colors.primary },
  countLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  warnCard: { borderColor: colors.warning, borderWidth: 1 },
  warnTitle: { ...typography.bodyStrong, color: colors.warning },
  warnText: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  tabRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  tabTextSelected: { color: colors.onPrimary },

  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    ...typography.body,
    color: colors.text,
  },

  dim: { opacity: 0.55 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  rowFaint: { ...typography.caption, color: colors.textFaint },

  fieldLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  choiceText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  choiceTextSelected: { color: colors.onPrimary },
});
