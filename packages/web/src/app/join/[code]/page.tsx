import React from 'react';
import Link from 'next/link';
import { RoomInviteTicket } from '@/components/RoomInviteTicket';

export default async function JoinCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const decodedCode = decodeURIComponent(code).toUpperCase();

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
          Invitation Pass Verified
        </span>
        <h2 className="font-display font-bold text-2xl text-text">
          Room #{decodedCode}
        </h2>
        <p className="text-xs text-muted mt-1">
          Your admission stub is ready. Present your pass to enter the screening room.
        </p>
      </div>

      <RoomInviteTicket
        invite={{
          roomCode: decodedCode,
          roomName: `Suite #${decodedCode}`,
          hostName: 'Elena Rostova',
          mediaTitle: '2001: A Space Odyssey (Roadshow Cut)',
          mediaFormat: '70mm Panavision • E2EE Sealed',
          memberCount: 5,
        }}
      />
    </div>
  );
}
