'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { TheatreAuditorium } from '@/components/theatre/TheatreAuditorium';

export default function TheatreRoomPage() {
  const params = useParams();
  const rawCode = (params?.code as string) || '';
  const decodedCode = decodeURIComponent(rawCode).toUpperCase().trim();

  return <TheatreAuditorium roomCode={decodedCode} />;
}
