import { NextResponse } from 'next/server';
import { MOVIE_CATALOGUE } from '@watchparty/shared';

// In-memory fallback room storage for serverless / edge environments
const inMemoryRooms = new Map<string, any>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendUrl = process.env.API_BACKEND_URL || 'https://watchparty-server-2zjh.onrender.com';
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/rooms`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // Backend unavailable, fallback to in-memory
    }
  }

  const rooms = Array.from(inMemoryRooms.values()).map((r) => ({
    roomId: r.roomId,
    roomCode: r.roomCode,
    roomName: r.roomName,
    hostUserName: r.hostUserName,
    memberCount: r.memberCount || 1,
    mediaTitle: r.mediaTitle || 'Synchronized Screening',
    controlMode: 'collaborative',
  }));

  return NextResponse.json({ rooms });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const backendUrl = process.env.API_BACKEND_URL || 'https://watchparty-server-2zjh.onrender.com';

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, { status: 201 });
      }
    } catch {
      // Backend unavailable, fallback to local room creation
    }
  }

  // Fallback room creation
  const roomCode = (body.roomCode ? String(body.roomCode).toUpperCase().trim() : '') || generateCode();
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const hostUserId = `user_${Date.now()}`;
  const hostSessionToken = `token_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const hostUserName = body.hostUserName || 'Host';
  const roomName = body.roomName || `Cinema Suite ${roomCode}`;

  const room = {
    roomId,
    roomCode,
    roomName,
    hostId: hostUserId,
    hostUserName,
    mediaTitle: 'Public Domain Cinema Classic',
    memberCount: 1,
    createdAt: Date.now(),
  };

  inMemoryRooms.set(roomCode, room);

  return NextResponse.json(
    {
      room: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        roomName: room.roomName,
        hostId: hostUserId,
      },
      hostUserId,
      hostSessionToken,
    },
    { status: 201 }
  );
}
