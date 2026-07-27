import React from 'react';
import { NotImplemented, Screen, Title, Muted } from '@/ui/components';

/** Screen 18 — exception approval. Phase 5. */
export default function ExceptionsScreen() {
  return (
    <Screen>
      <Title>Онцгой тохиолдол батлах</Title>
      <Muted>
        Төлөөлөгчдийн илгээсэн онцгой тохиолдол, цуцлалтын хүсэлтийг энд батална.
        Хэн ч өөрийн хүсэлтээ батлах боломжгүй.
      </Muted>
      <NotImplemented what="Хүсэлт батлах, татгалзах" phase="Шат 5" />
    </Screen>
  );
}
