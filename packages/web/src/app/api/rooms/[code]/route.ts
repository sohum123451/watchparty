import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const roomCode = decodeURIComponent(code).toUpperCase().trim();
  const rawBackend = process.env.API_BACKEND_URL;
  const backendUrl =
    rawBackend && !rawBackend.includes('pinggy') && !rawBackend.includes('localhost')
      ? rawBackend
      : 'https://watchparty-server-2zjh.onrender.com';

  try {
    const res = await fetch(`${backendUrl}/api/rooms/${encodeURIComponent(roomCode)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    if (res.status === 404) {
      return NextResponse.json({ exists: false, error: 'Room not found' }, { status: 404 });
    }
  } catch {}

  return NextResponse.json({ exists: false, error: 'Room not found' }, { status: 404 });
}
