import React from 'react';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchBrands, fetchClinics, fetchDoctors } from '@/services/api';
import { mn } from '@/i18n/mn';
import { Card, Heading, Muted, Screen } from '@/ui/components';

/** Hub for the read-only reference data every role may browse. */
export default function DirectoryHome() {
  const counts = useQuery({
    queryKey: ['directory-counts'],
    queryFn: async () => {
      const [clinics, doctors, brands] = await Promise.all([
        fetchClinics(),
        fetchDoctors(),
        fetchBrands(),
      ]);
      return { clinics: clinics.length, doctors: doctors.length, brands: brands.length };
    },
  });

  const suffix = (n: number | undefined) => (n === undefined ? '' : ` (${n})`);

  return (
    <>
      <Stack.Screen options={{ title: mn.tabs.directory }} />
      <Screen>
        <Card onPress={() => router.push('/(app)/directory/clinics')}>
          <Heading>{`${mn.clinics.title}${suffix(counts.data?.clinics)}`}</Heading>
          <Muted>Эмнэлгийн хаяг, байршил, зөвшөөрөгдөх зай</Muted>
        </Card>

        <Card onPress={() => router.push('/(app)/directory/doctors')}>
          <Heading>{`${mn.doctors.title}${suffix(counts.data?.doctors)}`}</Heading>
          <Muted>Эмчийн мэргэжил, ажилладаг эмнэлэг</Muted>
        </Card>

        <Card onPress={() => router.push('/(app)/directory/brands')}>
          <Heading>{`${mn.brands.title}${suffix(counts.data?.brands)}`}</Heading>
          <Muted>Брэнд, бүтээгдэхүүн, надад хуваарилагдсан брэнд</Muted>
        </Card>
      </Screen>
    </>
  );
}
