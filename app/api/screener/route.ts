import { NextResponse } from 'next/server';
import { fetchScreener, type ScreenerResult } from '@/lib/screener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 10 * 60 * 1000;

let cache: { at: number; data: ScreenerResult } | null = null;
let inFlight: Promise<ScreenerResult> | null = null;

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    if (!inFlight) {
      inFlight = fetchScreener(50).finally(() => {
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
