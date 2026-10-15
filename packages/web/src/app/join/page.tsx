'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { RoomInviteTicket } from '@/components/RoomInviteTicket';

export default function JoinPage() {
  const [roomCode, setRoomCode] = useState('CRITERION-70MM');

  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <Link
          href="/"
          className="font-mono text-xs text-muted hover:text-accent transition-colors"
        >
          ← Return to Grand Foyer
        </Link>
      </div>

      <div className="mb-6 w-full max-w-md text-center">
        <span className="font-mono text-xs text-accent uppercase tracking-widest block mb-1">
          Admission Box Office
        </span>
        <h2 className="font-display font-bold text-2xl text-text">
          Enter Balcony Suite
        </h2>
        <p className="text-xs text-muted mt-1">
          Review your room pass below and tear the stub to take your seat.
        </p>
      </div>

      <RoomInviteTicket
        invite={{
          roomCode,
          roomName: 'Balcony Suite 4',
          hostName: 'Elena Rostova',
          mediaTitle: 'Stalker (1979) — Tarkovsky 4K Restored',
          mediaFormat: '35mm Gate • E2EE Sealed',
          memberCount: 4,
        }}
      />
    </div>
  );
}
