import { NextResponse } from 'next/server';
import { fetchStockData } from '@/lib/stock-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { at: number; data: Awaited<ReturnType<typeof fetchStockData>> }>();
const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof fetchStockData>>>>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: '유효한 6자리 종목코드가 필요합니다' }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(code);
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  try {
    let promise = inFlight.get(code);
    if (!promise) {
      promise = fetchStockData(code).finally(() => {
        inFlight.delete(code);
      });
      inFlight.set(code, promise);
    }
    const data = await promise;
    cache.set(code, { at: Date.now(), data });
    return NextResponse.json({ ...data, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
