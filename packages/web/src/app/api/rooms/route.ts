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
  const rawBackend = process.env.API_BACKEND_URL;
  const backendUrl =
    rawBackend && !rawBackend.includes('pinggy') && !rawBackend.includes('localhost')
      ? rawBackend
      : 'https://watchparty-server-2zjh.onrender.com';

  try {
    const res = await fetch(`${backendUrl}/api/rooms`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  return NextResponse.json({ rooms: [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rawBackend = process.env.API_BACKEND_URL;
  const backendUrl =
    rawBackend && !rawBackend.includes('pinggy') && !rawBackend.includes('localhost')
      ? rawBackend
      : 'https://watchparty-server-2zjh.onrender.com';

  try {
    const res = await fetch(`${backendUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, { status: 201 });
    }
    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: errData?.error || 'Failed to create room on server' },
      { status: res.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Backend server is waking up. Please retry in a few seconds.' },
      { status: 503 }
    );
  }
}
