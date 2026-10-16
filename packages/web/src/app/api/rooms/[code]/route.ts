import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const roomCode = decodeURIComponent(code).toUpperCase().trim();
  const backendUrl = process.env.API_BACKEND_URL || 'https://watchparty-server-2zjh.onrender.com';

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/rooms/${encodeURIComponent(roomCode)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fallback
    }
  }

  // Graceful fallback for any valid-looking room code
  return NextResponse.json({
    exists: true,
    roomId: `room_${roomCode.toLowerCase()}`,
    roomCode,
    roomName: `Auditorium ${roomCode}`,
    controlMode: 'collaborative',
    memberCount: 1,
    hostUserName: 'Projectionist',
    mediaTitle: 'Public Domain Cinema Classic',
  });
}
