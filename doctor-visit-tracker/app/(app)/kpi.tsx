import React from 'react';
import { NotImplemented, Screen, Title, Muted } from '@/ui/components';

/** Screen 16 — representative KPI. Phase 5. */
export default function KpiScreen() {
  return (
    <Screen>
      <Title>KPI</Title>
      <Muted>
        Гүйцэтгэлийн хувь, дундаж үргэлжлэх хугацаа, эмч болон эмнэлгийн хамрал энд
        харагдана. Тооцоолох дүрэм нь docs/05-KPI-RULES.md-д тодорхойлогдсон.
      </Muted>
      <NotImplemented what="KPI тооцоолол ба харуулалт" phase="Шат 5" />
    </Screen>
  );
}
