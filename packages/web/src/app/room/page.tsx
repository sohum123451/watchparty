'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DefaultTheatreRoomPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/lobby');
  }, [router]);

  return null;
}
