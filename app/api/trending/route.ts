import { NextResponse } from 'next/server';
import { fetchTrending, type TrendingResult } from '@/lib/trending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 5 * 60 * 1000;

let cache: { at: number; data: TrendingResult } | null = null;
let inFlight: Promise<TrendingResult> | null = null;

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    if (!inFlight) {
      inFlight = fetchTrending(25).finally(() => {
        inFlight = null;
      });
    }

    const data = await inFlight;
    cache = { at: Date.now(), data };

    return NextResponse.json({ ...data, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';

    if (cache) {
      return NextResponse.json({
        ...cache.data,
        cached: true,
        stale: true,
        warning: message,
      });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
