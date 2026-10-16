import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const backendUrl = process.env.API_BACKEND_URL;
  if (backendUrl) {
    try {
      const auth = req.headers.get('authorization');
      const cookie = req.headers.get('cookie');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (auth) headers['authorization'] = auth;
      if (cookie) headers['cookie'] = cookie;

      const res = await fetch(`${backendUrl}/api/friends`, {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fallback
    }
  }

  return NextResponse.json({ friends: [] });
}
