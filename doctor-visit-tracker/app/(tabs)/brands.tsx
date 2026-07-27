/**
 * Screen 15 — Брэнд ба бүтээгдэхүүн (Brands and products)
 *
 * A representative's own brands are listed first and marked, because that is
 * what scopes their work: two representatives may visit the same doctor for
 * different brands.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../src/lib/auth';
import { useAsyncData } from '../../src/data/useAsyncData';
import { fetchBrands, fetchMyBrandAssignments, fetchProducts } from '../../src/data/repositories';
import { Card, EmptyState, ErrorState, LoadingState, Pill, Section } from '../../src/components/ui';
import { mn } from '../../src/lib/i18n/mn';
import { formatDateMn } from '../../src/lib/datetime';
import { colors, radius, spacing, typography } from '../../src/theme';
import type { Brand, Product } from '../../src/data/types';

export default function BrandsScreen() {
  const { profile } = useSession();
  const [expanded, setExpanded] = useState<string | null>(null);

  const loader = useCallback(async () => {
    const [brands, products] = await Promise.all([fetchBrands(), fetchProducts()]);
    if (brands.error) return { data: null, error: brands.error };
    if (products.error) return { data: null, error: products.error };

    // Only representatives have assignments; a manager sees the whole catalogue.
    const assignments =
      profile?.role === 'representative'
        ? await fetchMyBrandAssignments(profile.id)
        : { data: [], error: null };
    if (assignments.error) return { data: null, error: assignments.error };

    return {
      data: {
        brands: brands.data ?? [],
        products: products.data ?? [],
        assignedBrandIds: new Map(
          (assignments.data ?? []).map((a) => [a.brand_id, a.start_date]),
        ),
      },
      error: null,
    };
  }, [profile?.id, profile?.role]);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData(loader, [
    profile?.id,
    profile?.role,
  ]);

  const productsByBrand = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of data?.products ?? []) {
      const list = map.get(product.brand_id);
      if (list) list.push(product);
      else map.set(product.brand_id, [product]);
    }
    return map;
  }, [data?.products]);

  const { mine, others } = useMemo(() => {
    const assigned = data?.assignedBrandIds ?? new Map<string, string>();
    const mineList: Brand[] = [];
    const othersList: Brand[] = [];
    for (const brand of data?.brands ?? []) {
      if (assigned.has(brand.id)) mineList.push(brand);
      else othersList.push(brand);
    }
    return { mine: mineList, others: othersList };
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.brands.length) return <EmptyState label={mn.brands.empty} />;

  const renderBrand = (brand: Brand, assignedSince?: string) => {
    const products = productsByBrand.get(brand.id) ?? [];
    const isOpen = expanded === brand.id;

    return (
      <Card key={brand.id}>
        <Pressable
          onPress={() => setExpanded(isOpen ? null : brand.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          style={styles.brandHeader}
        >
          <View style={styles.brandTitleBlock}>
            <Text style={styles.brandName}>{brand.name}</Text>
            <Text style={styles.brandCategory}>{brand.category}</Text>
            {assignedSince ? (
              <Text style={styles.assigned}>
                {mn.brands.assignedSince(formatDateMn(assignedSince))}
              </Text>
            ) : null}
          </View>
          <View style={styles.brandSide}>
            {assignedSince ? <Pill label={mn.common.active} tone="success" /> : null}
            <Text style={styles.productCount}>{mn.brands.productCount(products.length)}</Text>
            <Text style={styles.chevron}>{isOpen ? '▾' : '▸'}</Text>
          </View>
        </Pressable>

        {isOpen ? (
          <View style={styles.productList}>
            {products.length === 0 ? (
              <Text style={styles.muted}>{mn.common.empty}</Text>
            ) : (
              products.map((product) => (
                <View key={product.id} style={styles.productRow}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {product.name}
                  </Text>
                  <Text style={styles.productSku}>{product.sku}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {mine.length > 0 ? (
        <Section title={mn.brands.myBrands}>
          {mine.map((brand) => renderBrand(brand, data.assignedBrandIds.get(brand.id)))}
        </Section>
      ) : null}

      <Section title={mine.length > 0 ? mn.brands.otherBrands : mn.brands.allBrands}>
        {others.map((brand) => renderBrand(brand))}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },

  brandHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  brandTitleBlock: { flex: 1, gap: 2 },
  brandName: { ...typography.heading, color: colors.text },
  brandCategory: { ...typography.caption, color: colors.textMuted },
  assigned: { ...typography.caption, color: colors.success, fontWeight: '600' },
  brandSide: { alignItems: 'flex-end', gap: 4 },
  productCount: { ...typography.caption, color: colors.textFaint },
  chevron: { fontSize: 18, color: colors.textMuted },

  productList: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
  },
  productName: { ...typography.body, color: colors.text, flex: 1 },
  productSku: {
    ...typography.caption,
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  muted: { ...typography.body, color: colors.textMuted },
});
