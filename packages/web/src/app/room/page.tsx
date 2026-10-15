import React from 'react';
import { TheatreAuditorium } from '@/components/theatre/TheatreAuditorium';

export default function DefaultTheatreRoomPage() {
  return (
    <TheatreAuditorium
      roomCode="CRITERION-70MM"
      initialTitle="Blade Runner (Final Cut): 70mm Restoration"
    />
  );
}
