import { NextResponse } from 'next/server';
import historyData from '@/data/market-history.json';
import {
  buildBuckets,
  computeTemperatureSeries,
  temperatureLabel,
  temperatureQuote,
  temperatureReturnCorrelation,
  nonOverlappingValidation,
  walkForwardScorecard,
  AXIS_WEIGHTS,
  AXIS_META,
  type MarketRow,
} from '@/lib/thermometer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;
let inFlight: Promise<unknown> | null = null;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** FRED에서 최근 값 하나 (cosd로 범위를 좁혀 가볍게) */
async function fredLatest(id: string, sinceDays = 120): Promise<{ d: string; v: number } | null> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const csv = await res.text();
  const lines = csv.trim().split('\n').slice(1);
  for (let i = lines.length - 1; i >= 0; i--) {
    const [d, v] = lines[i].split(',');
    const n = Number((v ?? '').trim());
    if (Number.isFinite(n)) return { d: d.trim(), v: n };
  }
  return null;
}

async function latestKospi(): Promise<{ d: string; v: number } | null> {
  const res = await fetch('https://finance.naver.com/sise/sise_index_day.naver?code=KOSPI&page=1', {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const iconv = (await import('iconv-lite')).default;
  const html = iconv.decode(buf, 'EUC-KR');
  const m = html.match(/<td class="date">(\d{4})\.(\d{2})\.(\d{2})<\/td>[\s\S]*?<td class="number_1">([\d,.]+)<\/td>/);
  if (!m) return null;
  return { d: `${m[1]}-${m[2]}-${m[3]}`, v: Number(m[4].replace(/,/g, '')) };
}

async function build() {
  const rows = (historyData as { rows: MarketRow[]; builtAt: string }).rows;

  // 1) 역사 시리즈 + 분포 + 자체 검증
  const series = computeTemperatureSeries(rows);
  const buckets = buildBuckets(series, 20);
  const validation = temperatureReturnCorrelation(series);
  const honest = nonOverlappingValidation(series);
  const scorecard = walkForwardScorecard(series);

  // 2) 오늘 값 (실패해도 역사 통계는 반환)
  let current = series[series.length - 1] ?? null;
  let live = false;
  try {
    const [k, vix, fx, y10] = await Promise.all([
      latestKospi(),
      fredLatest('VIXCLS'),
      fredLatest('DEXKOUS'),
      fredLatest('DGS10'),
    ]);
    if (k && vix && fx && y10) {
      const lastRow = rows[rows.length - 1];
      if (k.d >= lastRow.d) {
        const merged: MarketRow[] = [
          ...rows.filter((r) => r.d < k.d),
          { d: k.d, kospi: k.v, vix: vix.v, fx: fx.v, y10: y10.v, spread: lastRow.spread, expYoY: lastRow.expYoY },
        ];
        const s2 = computeTemperatureSeries(merged);
        const last = s2[s2.length - 1];
        if (last && last.d === k.d) {
          current = last;
          live = true;
        }
      }
    }
  } catch {
    // 라이브 실패 시 마지막 배치 값 사용
  }

  const myBucket =
    current !== null
      ? buckets.find((b) => current!.temp >= b.from && current!.temp < b.to) ?? null
      : null;

  return {
    builtAt: (historyData as { builtAt: string }).builtAt,
    live,
    coverage: {
      from: series[0]?.d ?? null,
      to: series[series.length - 1]?.d ?? null,
      days: series.length,
    },
    current: current
      ? {
          date: current.d,
          kospi: current.kospi,
          temp: current.temp,
          label: temperatureLabel(current.temp),
          quote: temperatureQuote(current.temp),
          inverted: current.inverted,
          axes: current.axes.map((a) => ({
            ...a,
            label: AXIS_META[a.key].label,
            unit: AXIS_META[a.key].unit,
            weight: AXIS_WEIGHTS[a.key],
            hot: AXIS_META[a.key].hot,
            cold: AXIS_META[a.key].cold,
          })),
        }
      : null,
    myBucket,
    buckets,
    validation,
    honest: { correlation: honest.correlation, n: honest.n, points: honest.points },
    scorecard,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json({ ...(cache.data as object), cached: true });
  }
  try {
    if (!inFlight) {
      inFlight = build().finally(() => {
        inFlight = null;
      });
    }
    const data = await inFlight;
    cache = { at: Date.now(), data };
    return NextResponse.json({ ...(data as object), cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    if (cache) return NextResponse.json({ ...(cache.data as object), cached: true, stale: true, warning: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
