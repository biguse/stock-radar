import { NextResponse } from 'next/server';
import historyData from '@/data/market-history.json';
import {
  expandingPercentileSeries,
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

/**
 * 오늘의 원/달러 — 네이버 실시간.
 * FRED DEXKOUS는 미국 연준 H.10 기준이라 최대 일주일 늦게 갱신된다.
 * 역사 시계열은 FRED(1981~)를 쓰되, 오늘 값만 네이버에서 가져온다.
 * (매매기준율 vs 뉴욕 정오환율 차이는 0.1% 수준으로 백분위 산출에 영향 없음)
 */
async function latestUsdKrwFromNaver(): Promise<{ d: string; v: number } | null> {
  try {
    const res = await fetch('https://finance.naver.com/marketindex/', {
      headers: { 'User-Agent': UA },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const iconv = (await import('iconv-lite')).default;
    const html = iconv.decode(buf, 'EUC-KR');
    const anchor = html.indexOf('미국 USD');
    if (anchor < 0) return null;
    const m = html.slice(anchor).match(/<span class="value">([\d,.]+)<\/span>/);
    if (!m) return null;
    const v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) return null;
    return { d: new Date().toISOString().slice(0, 10), v };
  } catch {
    return null;
  }
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
    const [k, vix, fxNaver, fxFred, y10] = await Promise.all([
      latestKospi(),
      fredLatest('VIXCLS'),
      latestUsdKrwFromNaver(),
      fredLatest('DEXKOUS'),
      fredLatest('DGS10'),
    ]);
    const fx = fxNaver ?? fxFred;
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

  // 밸류에이션 잣대 (KRX 지수 PER/PBR) — 온도에는 넣지 않고 보조 지표로 제시
  const perSeries = expandingPercentileSeries(rows.map((r) => r.per ?? null), { warmup: 750 });
  const pbrSeries = expandingPercentileSeries(rows.map((r) => r.pbr ?? null), { warmup: 750 });
  function latestOf(raw: (number | null | undefined)[], pct: (number | null)[]) {
    for (let i = raw.length - 1; i >= 0; i--) {
      const v = raw[i];
      const p = pct[i];
      if (v !== null && v !== undefined && p !== null) {
        return { raw: v, score: Math.round(p * 10) / 10, date: rows[i].d };
      }
    }
    return null;
  }
  const valuation = {
    per: latestOf(rows.map((r) => r.per), perSeries),
    pbr: latestOf(rows.map((r) => r.pbr), pbrSeries),
  };

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
    valuation,
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
