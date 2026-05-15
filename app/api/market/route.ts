import { NextResponse } from 'next/server';
import { fetchMarketPulse, type MarketPulse } from '@/lib/market';
import rawStocks from '@/data/stocks.sample.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 30 * 60 * 1000;

let cache: { at: number; data: MarketPulse } | null = null;
let inFlight: Promise<MarketPulse> | null = null;

const watchlistCodes = (rawStocks as { code: string }[]).map((s) => s.code);

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    if (!inFlight) {
      inFlight = fetchMarketPulse(watchlistCodes).finally(() => {
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
