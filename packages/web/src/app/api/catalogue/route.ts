import { NextResponse } from 'next/server';
import { MOVIE_CATALOGUE } from '@watchparty/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendUrl = process.env.API_BACKEND_URL;

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/catalogue`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {}
  }

  return NextResponse.json({
    films: MOVIE_CATALOGUE,
    total: MOVIE_CATALOGUE.length,
  });
}
