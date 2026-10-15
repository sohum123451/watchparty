'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { TheatreAuditorium } from '@/components/theatre/TheatreAuditorium';

export default function TheatreRoomPage() {
  const params = useParams();
  const rawCode = (params?.code as string) || 'CRITERION-70MM';
  const decodedCode = decodeURIComponent(rawCode).toUpperCase();

  return (
    <TheatreAuditorium
      roomCode={decodedCode}
      initialTitle={`Suite #${decodedCode}: 70mm Private Screening`}
    />
  );
}
