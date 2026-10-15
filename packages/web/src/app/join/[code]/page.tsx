import React from 'react';
import Link from 'next/link';
import { RoomInviteTicket } from '@/components/RoomInviteTicket';

export default async function JoinCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const decodedCode = decodeURIComponent(code).toUpperCase().trim();

  let roomData: any = null;
  const apiUrl = process.env.API_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${apiUrl}/api/rooms/${encodeURIComponent(decodedCode)}`, { cache: 'no-store' });
    if (res.ok) {
      roomData = await res.json();
    }
  } catch {}

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
        <h2 className="font-display font-semibold text-2xl text-text">
          Room #{decodedCode}
        </h2>
        <p className="text-sm text-muted mt-1">
          {roomData?.exists ? 'Your pass is ready.' : 'Checking auditorium pass…'}
        </p>
      </div>

      <RoomInviteTicket
        invite={{
          roomCode: decodedCode,
          roomName: roomData?.roomName || `Room ${decodedCode}`,
          hostName: roomData?.hostUserName || 'Auditorium Host',
          mediaTitle: roomData?.mediaTitle || 'Synchronized Screening',
          mediaFormat: 'Synchronized Cinema',
          memberCount: roomData?.memberCount || 1,
        }}
      />
    </div>
  );
}
