import React from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/state/AuthContext';
import {
  fetchBrands,
  fetchClinics,
  fetchDoctors,
  fetchMyBrandAssignments,
  fetchProducts,
  fetchStaffDirectory,
} from '@/services/api';
import { mn } from '@/i18n/mn';
import { colors, spacing } from '@/theme/tokens';
import {
  Badge,
  Body,
  Card,
  ErrorState,
  Heading,
  LoadingState,
  Muted,
  NotImplemented,
  Row,
  Screen,
  Title,
} from '@/ui/components';

export default function HomeScreen() {
  const { profile } = useAuth();

  const counts = useQuery({
    queryKey: ['home-counts', profile?.role],
    queryFn: async () => {
      const [clinics, doctors, brands, products, staff, myBrands] = await Promise.all([
        fetchClinics(),
        fetchDoctors(),
        fetchBrands(),
        fetchProducts(),
        fetchStaffDirectory(),
        fetchMyBrandAssignments(),
      ]);
      return {
        clinics: clinics.length,
        doctors: doctors.length,
        brands: brands.length,
        products: products.length,
        staff: staff.length,
        myBrandNames: myBrands
          .map((a) => brands.find((b) => b.id === a.brand_id)?.name)
          .filter((n): n is string => Boolean(n))
          .sort(),
      };
    },
    enabled: Boolean(profile),
  });

  if (!profile) return <LoadingState />;

  const roleLabel = mn.roles[profile.role];

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <Title>{mn.home.greeting(profile.full_name)}</Title>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Badge label={roleLabel} tone="info" />
          {profile.employee_code ? <Muted>{profile.employee_code}</Muted> : null}
        </View>
      </View>

      {counts.isLoading ? <LoadingState /> : null}

      {counts.isError ? (
        <ErrorState
          message={counts.error instanceof Error ? counts.error.message : mn.common.error}
          onRetry={() => void counts.refetch()}
        />
      ) : null}

      {counts.data ? (
        <>
          <Card>
            <Heading>{mn.home.referenceData}</Heading>
            <Row label={mn.home.clinicsCount} value={String(counts.data.clinics)} emphasis />
            <Row label={mn.home.doctorsCount} value={String(counts.data.doctors)} emphasis />
            <Row label={mn.home.brandsCount} value={String(counts.data.brands)} emphasis />
            <Row label={mn.home.productsCount} value={String(counts.data.products)} emphasis />
            <Row label={mn.home.staffCount} value={String(counts.data.staff)} emphasis />
          </Card>

          {profile.role === 'representative' ? (
            <Card>
              <Heading>{mn.home.myBrands}</Heading>
              {counts.data.myBrandNames.length === 0 ? (
                <Muted>{mn.home.myBrandsEmpty}</Muted>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {counts.data.myBrandNames.map((name) => (
                    <Badge key={name} label={name} tone="success" />
                  ))}
                </View>
              )}
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <Heading>{mn.home.quickLinks}</Heading>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Link href="/(app)/directory" style={{ color: colors.primary, fontSize: 16, paddingVertical: 8 }}>
            {mn.tabs.directory} →
          </Link>
          <Link href="/(app)/settings" style={{ color: colors.primary, fontSize: 16, paddingVertical: 8 }}>
            {mn.settings.title} →
          </Link>
          <Link
            href="/(app)/settings/privacy"
            style={{ color: colors.primary, fontSize: 16, paddingVertical: 8 }}
          >
            {mn.settings.privacy} →
          </Link>
        </View>
      </Card>

      {/*
        The requirement is explicit: no fake buttons. Everything the dashboard
        will eventually show is named here and clearly marked as not built yet,
        so nobody wastes time looking for it.
      */}
      <Heading>{mn.home.comingSoonTitle}</Heading>

      {profile.role === 'representative' ? (
        <>
          <NotImplemented what="Өнөөдрийн уулзалт, дууссан, үлдсэн тоо" phase="Шат 2-3" />
          <NotImplemented what="Энэ долоо хоногийн KPI" phase="Шат 5" />
          <NotImplemented what="Хүлээгдэж буй дараагийн алхам" phase="Шат 4" />
          <NotImplemented what="Синк төлөв" phase="Шат 7" />
        </>
      ) : null}

      {profile.role === 'manager' ? (
        <>
          <NotImplemented what="Багийн KPI ба төлөөлөгчдийн эрэмбэ" phase="Шат 5-6" />
          <NotImplemented what="Биелээгүй уулзалт, хүлээгдэж буй хүсэлт" phase="Шат 5" />
          <NotImplemented what="Анхаарах уулзалт, сүүлийн уулзалтын газрын зураг" phase="Шат 6" />
        </>
      ) : null}

      {profile.role === 'administrator' ? (
        <>
          <Body>Үндсэн мэдээллийн удирдлага бүрэн ажиллаж байна.</Body>
          <NotImplemented what="Excel/CSV импорт" phase="Шат 6" />
          <NotImplemented what="KPI тохиргоо, хадгалалтын хугацааны тохиргоо" phase="Шат 5-7" />
        </>
      ) : null}
    </Screen>
  );
}
