import React from 'react';
import { NotImplemented, Screen, Title, Muted } from '@/ui/components';

/** Screen 17 — manager dashboard. Phase 6. */
export default function DashboardScreen() {
  return (
    <Screen>
      <Title>Менежерийн хяналтын самбар</Title>
      <Muted>
        Багийн гүйцэтгэл, биелээгүй уулзалт, анхаарах уулзалтууд, брэндийн идэвх энд
        харагдана.
      </Muted>
      <NotImplemented what="Багийн KPI ба эрэмбэ" phase="Шат 6" />
      <NotImplemented what="Сүүлийн уулзалтуудын газрын зураг" phase="Шат 6" />
    </Screen>
  );
}
