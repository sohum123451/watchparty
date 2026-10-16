import { NextResponse } from 'next/server';

export async function POST() {
  const backendUrl = process.env.API_BACKEND_URL;

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/auth/refresh`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {}
  }

  return NextResponse.json({ accessToken: null, user: null }, { status: 401 });
}
