import React from 'react';
import { NotImplemented, Screen, Title, Muted } from '@/ui/components';

/** Screens 4 and 5 — weekly calendar and plan builder. Phase 2. */
export default function PlanScreen() {
  return (
    <Screen>
      <Title>Долоо хоногийн төлөвлөгөө</Title>
      <Muted>
        Энэ дэлгэц дээр долоо хоногийн уулзалтын төлөвлөгөө үүсгэж, ноороглон хадгалж,
        менежерт илгээнэ.
      </Muted>
      <NotImplemented what="Долоо хоногийн хуанли" phase="Шат 2" />
      <NotImplemented what="Төлөвлөгөө боловсруулах алхам алхмаар" phase="Шат 2" />
    </Screen>
  );
}
