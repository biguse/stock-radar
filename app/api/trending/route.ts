import { NextResponse } from 'next/server';
import { fetchTrending, type TrendingResult } from '@/lib/trending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 5 * 60 * 1000;

let cache: { at: number; data: TrendingResult } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }
  try {
    const data = await fetchTrending(25);
    cache = { at: now, data };
    return NextResponse.json({ ...data, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
