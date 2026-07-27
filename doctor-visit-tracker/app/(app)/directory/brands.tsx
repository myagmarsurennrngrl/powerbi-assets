import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  fetchBrands,
  fetchMyBrandAssignments,
  fetchProducts,
  type Product,
} from '@/services/api';
import { mn } from '@/i18n/mn';
import { spacing } from '@/theme/tokens';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
  Muted,
  Screen,
} from '@/ui/components';

/** Screen 15 — Брэнд ба бүтээгдэхүүн. */
export default function BrandsScreen() {
  const query = useQuery({
    queryKey: ['brands-with-products'],
    queryFn: async () => {
      const [brands, products, mine] = await Promise.all([
        fetchBrands(),
        fetchProducts(),
        fetchMyBrandAssignments(),
      ]);
      const mineIds = new Set(mine.map((a) => a.brand_id));
      const byBrand = new Map<string, Product[]>();
      for (const p of products) {
        const list = byBrand.get(p.brand_id) ?? [];
        list.push(p);
        byBrand.set(p.brand_id, list);
      }
      return { brands, byBrand, mineIds };
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : mn.common.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { brands, byBrand, mineIds } = query.data;

  if (brands.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: mn.brands.title }} />
        <EmptyState message={mn.brands.empty} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: mn.brands.title }} />
      <Screen>
        {brands.map((brand) => {
          const products = byBrand.get(brand.id) ?? [];
          return (
            <Card key={brand.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Heading>{brand.name}</Heading>
                {mineIds.has(brand.id) ? (
                  <Badge label={mn.brands.assignedToMe} tone="success" />
                ) : null}
              </View>
              <Muted>{brand.category ?? '—'}</Muted>
              <Muted>{mn.brands.productCount(products.length)}</Muted>

              <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                {products.map((p) => (
                  <Muted key={p.id}>{`• ${p.name}  (${p.sku})`}</Muted>
                ))}
              </View>
            </Card>
          );
        })}
      </Screen>
    </>
  );
}
