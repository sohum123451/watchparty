import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = (body.displayName as string)?.trim() || `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
  const backendUrl = process.env.API_BACKEND_URL;

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fallback
    }
  }

  const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return NextResponse.json({
    user: {
      id: guestId,
      displayName: name,
      isGuest: true,
    },
    accessToken: null,
  });
}
