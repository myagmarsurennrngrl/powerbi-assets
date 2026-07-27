import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchBrands,
  fetchProducts,
  upsertBrand,
  upsertProduct,
  type Brand,
  type Product,
} from '@/services/api';
import { brandSchema, productSchema, toFieldErrors } from '@/domain/validation';
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

type Editing =
  | { kind: 'brand'; brand: Brand | null }
  | { kind: 'product'; product: Product | null }
  | null;

export default function AdminBrandsScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);

  const query = useQuery({
    queryKey: ['admin-brands'],
    queryFn: async () => {
      const [brands, products] = await Promise.all([fetchBrands(true), fetchProducts(true)]);
      return { brands, products };
    },
  });

  const refresh = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-brands'] });
    void queryClient.invalidateQueries({ queryKey: ['brands-with-products'] });
  };

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (editing?.kind === 'brand') {
    return <BrandForm brand={editing.brand} onDone={refresh} onCancel={() => setEditing(null)} />;
  }
  if (editing?.kind === 'product') {
    return (
      <ProductForm
        product={editing.product}
        brands={query.data.brands}
        onDone={refresh}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const { brands, products } = query.data;

  return (
    <>
      <Stack.Screen options={{ title: mn.brands.title }} />
      <Screen>
        <Button label={mn.admin.addBrand} onPress={() => setEditing({ kind: 'brand', brand: null })} />
        <Button
          label={mn.admin.addProduct}
          onPress={() => setEditing({ kind: 'product', product: null })}
          variant="secondary"
          disabled={brands.length === 0}
        />

        {brands.length === 0 ? <EmptyState message={mn.brands.empty} /> : null}

        {brands.map((b) => {
          const own = products.filter((p) => p.brand_id === b.id);
          return (
            <Card key={b.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Heading>{b.name}</Heading>
                {!b.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
              </View>
              <Muted>{b.category ?? '—'}</Muted>
              <Button
                label={`Засах: ${b.name}`}
                onPress={() => setEditing({ kind: 'brand', brand: b })}
                variant="secondary"
              />
              <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                {own.map((p) => (
                  <Card key={p.id} onPress={() => setEditing({ kind: 'product', product: p })}>
                    <Muted>{`${p.name}  (${p.sku})`}</Muted>
                    {!p.is_active ? <Badge label={mn.common.inactive} tone="danger" /> : null}
                  </Card>
                ))}
              </View>
            </Card>
          );
        })}
      </Screen>
    </>
  );
}

function BrandForm({
  brand,
  onDone,
  onCancel,
}: {
  brand: Brand | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(brand?.name ?? '');
  const [category, setCategory] = useState(brand?.category ?? '');
  const [isActive, setIsActive] = useState(brand?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = brandSchema.safeParse({ name, category, is_active: isActive });
      if (!parsed.success) {
        setErrors(toFieldErrors(parsed.error));
        throw new Error('validation');
      }
      setErrors({});
      await upsertBrand(
        {
          name: parsed.data.name,
          category: parsed.data.category ? parsed.data.category : null,
          is_active: parsed.data.is_active,
        },
        brand?.id,
      );
    },
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof Error && e.message === 'validation') return;
      setServerError(e instanceof Error ? e.message : mn.common.error);
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: mn.admin.addBrand }} />
      <Screen>
        <Title>{brand ? 'Брэнд засах' : mn.admin.addBrand}</Title>
        <Field label="Нэр" value={name} onChangeText={setName} error={errors.name} />
        <Field label={mn.brands.category} value={category} onChangeText={setCategory} />
        <Toggle label={mn.admin.activeStatus} value={isActive} onChange={setIsActive} />
        {serverError ? <ErrorState message={serverError} /> : null}
        <Button
          label={mutation.isPending ? mn.common.saving : mn.common.save}
          onPress={() => mutation.mutate()}
          busy={mutation.isPending}
        />
        <Button label={mn.common.cancel} onPress={onCancel} variant="secondary" />
      </Screen>
    </>
  );
}

function ProductForm({
  product,
  brands,
  onDone,
  onCancel,
}: {
  product: Product | null;
  brands: Brand[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [brandId, setBrandId] = useState(product?.brand_id ?? brands[0]?.id ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const brandOptions = useMemo(
    () => brands.map((b) => ({ value: b.id, label: b.name })),
    [brands],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = productSchema.safeParse({
        name,
        sku,
        brand_id: brandId,
        category,
        is_active: isActive,
      });
      if (!parsed.success) {
        setErrors(toFieldErrors(parsed.error));
        throw new Error('validation');
      }
      setErrors({});
      await upsertProduct(
        {
          name: parsed.data.name,
          sku: parsed.data.sku,
          brand_id: parsed.data.brand_id,
          category: parsed.data.category ? parsed.data.category : null,
          is_active: parsed.data.is_active,
        },
        product?.id,
      );
    },
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof Error && e.message === 'validation') return;
      setServerError(e instanceof Error ? e.message : mn.common.error);
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: mn.admin.addProduct }} />
      <Screen>
        <Title>{product ? 'Бүтээгдэхүүн засах' : mn.admin.addProduct}</Title>
        <Field label="Нэр" value={name} onChangeText={setName} error={errors.name} />
        <Field
          label={mn.brands.sku}
          value={sku}
          onChangeText={setSku}
          autoCapitalize="characters"
          error={errors.sku}
        />
        <ChipGroup
          label="Брэнд"
          options={brandOptions}
          value={brandId}
          onChange={setBrandId}
        />
        <Field label={mn.brands.category} value={category} onChangeText={setCategory} />
        <Toggle label={mn.admin.activeStatus} value={isActive} onChange={setIsActive} />
        {serverError ? <ErrorState message={serverError} /> : null}
        <Button
          label={mutation.isPending ? mn.common.saving : mn.common.save}
          onPress={() => mutation.mutate()}
          busy={mutation.isPending}
        />
        <Button label={mn.common.cancel} onPress={onCancel} variant="secondary" />
      </Screen>
    </>
  );
}
