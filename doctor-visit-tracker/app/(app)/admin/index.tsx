import React from 'react';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchBrands, fetchClinics, fetchDoctors, fetchProducts } from '@/services/api';
import { mn } from '@/i18n/mn';
import { Card, Heading, Muted, NotImplemented, Screen, Title } from '@/ui/components';

/** Screen 20 — Үндсэн мэдээллийн удирдлага. Administrators only. */
export default function MasterDataHome() {
  const counts = useQuery({
    queryKey: ['admin-counts'],
    queryFn: async () => {
      const [clinics, doctors, brands, products] = await Promise.all([
        fetchClinics(true),
        fetchDoctors(true),
        fetchBrands(true),
        fetchProducts(true),
      ]);
      return {
        clinics: clinics.length,
        doctors: doctors.length,
        brands: brands.length,
        products: products.length,
      };
    },
  });

  const n = (v: number | undefined) => (v === undefined ? '' : ` (${v})`);

  return (
    <>
      <Stack.Screen options={{ title: mn.admin.masterDataTitle }} />
      <Screen>
        <Title>{mn.admin.masterDataTitle}</Title>

        <Card onPress={() => router.push('/(app)/admin/clinics')}>
          <Heading>{`${mn.clinics.title}${n(counts.data?.clinics)}`}</Heading>
          <Muted>Хаяг, координат, геофенсийн радиус</Muted>
        </Card>

        <Card onPress={() => router.push('/(app)/admin/doctors')}>
          <Heading>{`${mn.doctors.title}${n(counts.data?.doctors)}`}</Heading>
          <Muted>Нэр, мэргэжил, холбоо барих</Muted>
        </Card>

        <Card onPress={() => router.push('/(app)/admin/brands')}>
          <Heading>{`${mn.brands.title}${n(counts.data?.brands)} / ${
            mn.brands.products
          }${n(counts.data?.products)}`}</Heading>
          <Muted>Брэнд ба бүтээгдэхүүн</Muted>
        </Card>

        <NotImplemented what="Excel / CSV импорт" phase="Шат 6" />
        <NotImplemented what="Эмч-эмнэлгийн холбоос засварлах" phase="Шат 2" />
        <NotImplemented what="Төлөөлөгч-брэндийн хуваарилалт засварлах" phase="Шат 2" />
        <NotImplemented what="Батлагдсан и-мэйл домэйны удирдлага" phase="Шат 6" />
      </Screen>
    </>
  );
}
