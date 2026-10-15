'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { TheatreAuditorium } from '@/components/theatre/TheatreAuditorium';

export default function TheatreRoomPage() {
  const params = useParams();
  const rawCode = (params?.code as string) || 'RM-4F7K';
  const decodedCode = decodeURIComponent(rawCode).toUpperCase();
  const isDefaultReference = decodedCode === 'RM-4F7K' || decodedCode === 'CRITERION-70MM';

  return (
    <TheatreAuditorium
      roomCode={decodedCode}
      initialTitle={isDefaultReference ? 'Friday Night Screening' : `Suite #${decodedCode}`}
    />
  );
}
