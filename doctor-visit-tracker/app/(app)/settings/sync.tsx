import React from 'react';
import { Stack } from 'expo-router';
import { mn } from '@/i18n/mn';
import { Body, NotImplemented, Screen, Title } from '@/ui/components';

/** Screen 22 — Синк төлөв. The offline engine lands in Phase 7. */
export default function SyncScreen() {
  return (
    <>
      <Stack.Screen options={{ title: mn.settings.syncStatus }} />
      <Screen>
        <Title>{mn.settings.syncStatus}</Title>
        <Body>
          Офлайн үед үүсгэсэн бичлэгүүд энд жагсаж, интернэт холбогдмогц автоматаар
          илгээгдэнэ. Бичлэг бүр «Синк хийгдсэн», «Хүлээгдэж байна», «Амжилтгүй» гэсэн
          гурван төлөвийн аль нэгийг харуулна.
        </Body>
        <NotImplemented what="Офлайн дараалал ба синк төлөв" phase="Шат 7" />
      </Screen>
    </>
  );
}
