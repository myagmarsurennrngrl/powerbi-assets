import React from 'react';
import { NotImplemented, Screen, Title, Muted } from '@/ui/components';

/**
 * Screen 3 — Өнөөдрийн маршрут.
 * Built in Phase 2 (route list) and Phase 3 (start visit / geofence).
 * Nothing is drawn that does not work.
 */
export default function TodayScreen() {
  return (
    <Screen>
      <Title>Өнөөдрийн маршрут</Title>
      <Muted>
        Энэ дэлгэц дээр өнөөдрийн төлөвлөсөн уулзалтууд, эмнэлэг хүртэлх зай, уулзалт
        эхлүүлэх товч харагдана.
      </Muted>
      <NotImplemented what="Өнөөдрийн маршрутын жагсаалт" phase="Шат 2" />
      <NotImplemented what="Байршил шалгаж уулзалт эхлүүлэх" phase="Шат 3" />
      <NotImplemented what="Онцгой тохиолдлын хүсэлт" phase="Шат 5" />
    </Screen>
  );
}
