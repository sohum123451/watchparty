import React from 'react';
import Link from 'next/link';
import { RoomInviteTicket } from '@/components/RoomInviteTicket';
import { ScissorsIcon } from '@/components/icons/CinemaIcons';

export default async function JoinCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const decodedCode = decodeURIComponent(code).toUpperCase().trim();

  let roomData: any = null;
  let fetchFailed = false;

  const backendUrl = (
    process.env.API_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001'
  ).replace(/\/+$/, '');

  try {
    const res = await fetch(`${backendUrl}/api/rooms/${encodeURIComponent(decodedCode)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      roomData = await res.json();
    } else if (res.status === 404) {
      fetchFailed = true;
    }
  } catch {
    fetchFailed = true;
  }

  // If room does not exist (404), render DESIGN.md Section 8 error state
  if (fetchFailed || (roomData && !roomData.exists && !roomData.roomId)) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-surface-2 border border-danger/40 rounded-ticket p-8 text-center shadow-surface">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center text-danger">
            <ScissorsIcon size={24} />
          </div>
          <h2 className="font-display font-bold text-2xl text-text mb-2 tracking-tight-display">
            Torn Ticket — Box Office Restricted
          </h2>
          <p className="text-sm text-muted mb-6">
            This pass has expired or belongs to another private balcony suite. Room #{decodedCode} could not be verified by the box office.
          </p>
          <Link
            href="/lobby"
            className="inline-flex items-center justify-center py-3 px-6 bg-surface-3 hover:bg-surface-3/80 border border-border-brass hover:border-accent text-text font-mono text-xs rounded-sm transition-all"
          >
            ← Return to Theatre Lobby
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <Link
          href="/lobby"
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
          Your pass is ready.
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
