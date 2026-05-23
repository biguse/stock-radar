import { NextResponse } from 'next/server';
import { fetchStockData } from '@/lib/stock-data';
import type { StockRaw } from '@/types/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type ResultItem =
  | { code: string; ok: true; stock: StockRaw; warnings: string[] }
  | { code: string; ok: false; error: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const codesParam = searchParams.get('codes');
  if (!codesParam) {
    return NextResponse.json({ error: 'codes 파라미터 필요 (예: 005930,000660)' }, { status: 400 });
  }
  const codes = Array.from(
    new Set(codesParam.split(',').map((s) => s.trim()).filter((c) => /^\d{6}$/.test(c))),
  ).slice(0, 100);

  if (codes.length === 0) {
    return NextResponse.json({ error: '유효한 종목코드가 없습니다' }, { status: 400 });
  }

  const BATCH = 4;
  const results: ResultItem[] = [];
  for (let i = 0; i < codes.length; i += BATCH) {
    const chunk = codes.slice(i, i + BATCH);
    const chunkResults = await Promise.all(
      chunk.map(async (code): Promise<ResultItem> => {
        try {
          const { stock, warnings } = await fetchStockData(code);
          return { code, ok: true, stock, warnings };
        } catch (e) {
          return { code, ok: false, error: e instanceof Error ? e.message : 'unknown error' };
        }
      }),
    );
    results.push(...chunkResults);
  }

  const successful = results.filter((r) => r.ok).length;
  return NextResponse.json({
    requested: codes.length,
    successful,
    failed: codes.length - successful,
    results,
  });
}
