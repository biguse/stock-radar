import { NextResponse } from 'next/server';
import historyData from '@/data/market-history.json';
import { holdingStats, payoffSensitivity, MEDALLION_WIN_RATE, COST } from '@/lib/trading-cost';
import bootstrapData from '@/data/bootstrap.json';
import {
  averageDividendYield,
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
  // 부트스트랩은 scripts/build-bootstrap.mjs가 10,000회 × 블록 3종으로 미리
  // 계산해 둔 결과를 읽는다. 런타임 400회로는 판정이 시드에 따라 뒤집힌다.
  const boot = bootstrapData as unknown as {
    reps: number; blocks: number[]; primaryBlock: number; builtAt: string;
    uncertainRange: number[];
    indicators?: Array<{
      key: string; label: string; note: string;
      rates: (number | null)[]; n: number; base: number; topRate: number; z: number;
    }>;
    byBlock: Record<string, Array<{
      from: number; to: number; medianLow: number; medianHigh: number;
      negLow: number; negHigh: number; signCertain: boolean; validReps: number;
    }>>;
  };
  const bucketCI = boot.byBlock[String(boot.primaryBlock)] ?? [];
  const bootstrapMeta = {
    reps: boot.reps, blocks: boot.blocks, primaryBlock: boot.primaryBlock,
    builtAt: boot.builtAt, uncertainRange: boot.uncertainRange,
  };
  const indicators = boot.indicators ?? [];
  const dividend = averageDividendYield(rows);
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

  // ── 네 가지 잣대 ────────────────────────────────────────────────
  // 같은 시장도 무엇으로 재느냐에 따라 답이 달라진다. 그 불일치를 보여주는 것이
  // 이 지표의 핵심이다. (검증: 이격도·PBR은 코스피 차트와 0.78~0.93으로 겹치고,
  //  PER·ERP는 독립적이지만 예측력이 없다 — /api/analysis 참조)
  const perPct = expandingPercentileSeries(rows.map((r) => r.per ?? null), { warmup: 750 });
  const pbrPct = expandingPercentileSeries(rows.map((r) => r.pbr ?? null), { warmup: 750 });
  const erpRaw = rows.map((r) =>
    r.per && r.per > 0 && r.kr10y !== null && r.kr10y !== undefined ? 100 / r.per - r.kr10y : null,
  );
  // 위험프리미엄은 낮을수록 보상이 얇다 = 뜨겁다
  const erpPct = expandingPercentileSeries(erpRaw, { warmup: 750, invert: true });

  function latest(raw: (number | null | undefined)[], pct: (number | null)[]) {
    for (let i = raw.length - 1; i >= 0; i--) {
      const v = raw[i];
      const p = pct[i];
      if (v !== null && v !== undefined && p !== null) {
        return { raw: Math.round(v * 100) / 100, score: Math.round(p * 10) / 10, date: rows[i].d };
      }
    }
    return null;
  }

  const gaugeDefs = [
    {
      key: 'trend',
      label: '주가 위치',
      question: '최근 5년 평균보다 얼마나 높이 올라왔나',
      value: current ? { raw: Math.round((current.axes.find((a) => a.key === 'price')?.raw ?? 0) * 100) / 100, score: current.temp, date: current.d } : null,
      format: (v: number) => `5년 평균 +${v.toFixed(0)}%`,
    },
    {
      key: 'pbr',
      label: '자산 대비',
      question: '기업이 가진 순자산의 몇 배에 거래되나',
      value: latest(rows.map((r) => r.pbr), pbrPct),
      format: (v: number) => `PBR ${v.toFixed(2)}배`,
    },
    {
      key: 'per',
      label: '이익 대비',
      question: '한 해 버는 돈의 몇 배에 거래되나',
      value: latest(rows.map((r) => r.per), perPct),
      format: (v: number) => `PER ${v.toFixed(1)}배`,
    },
    {
      key: 'erp',
      label: '위험 보상',
      question: '국채 대신 주식을 사는 대가로 얼마를 더 기대하나',
      value: latest(erpRaw, erpPct),
      format: (v: number) => `국채보다 +${v.toFixed(2)}%p`,
    },
  ];

  const gauges = gaugeDefs
    .filter((g) => g.value !== null)
    .map((g) => ({
      key: g.key,
      label: g.label,
      question: g.question,
      raw: g.value!.raw,
      rawText: g.format(g.value!.raw),
      score: g.value!.score,
      date: g.value!.date,
    }));

  const scores = gauges.map((g) => g.score).sort((a, b) => a - b);
  const range =
    scores.length > 0
      ? {
          min: scores[0],
          max: scores[scores.length - 1],
          median: scores[Math.floor(scores.length / 2)],
          spread: Math.round((scores[scores.length - 1] - scores[0]) * 10) / 10,
        }
      : null;

  // ── 상승 확률 ────────────────────────────────────────────────
  // 1일 후는 창이 겹치지 않아 독립 표본이 그대로 살아있다(9,400여 회).
  // 이 프로젝트에서 통계적으로 가장 단단한 숫자이며, 결론은
  // "내일에 대해서는 온도가 알려주는 게 거의 없다"이다.
  const devScores = computeTemperatureSeries(rows).reduce((m, t) => {
    m.set(t.d, t.temp);
    return m;
  }, new Map<string, number>());

  function upRate(h: number) {
    let up = 0;
    let n = 0;
    for (let i = 0; i + h < rows.length; i++) {
      if (rows[i + h].kospi > rows[i].kospi) up++;
      n++;
    }
    return { days: h, pUp: Math.round((up / n) * 1000) / 10, n, independent: Math.round(n / h) };
  }

  function tomorrowByTemp(size = 20) {
    const m = new Map<number, { up: number; n: number }>();
    for (let i = 0; i + 1 < rows.length; i++) {
      const sc = devScores.get(rows[i].d);
      if (sc === undefined) continue;
      const b = Math.min(Math.floor(sc / size), Math.ceil(100 / size) - 1);
      if (!m.has(b)) m.set(b, { up: 0, n: 0 });
      const e = m.get(b)!;
      if (rows[i + 1].kospi > rows[i].kospi) e.up++;
      e.n++;
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, e]) => ({ from: b * size, to: b * size + size, pUp: Math.round((e.up / e.n) * 1000) / 10, n: e.n }));
  }

  const byTemp = tomorrowByTemp();
  // 미래 휴장일은 알 수 없다(pykrx도 과거 거래일만 역산 가능).
  // 따라서 '내일'이라 단언하지 않고 '다음 거래일'로만 말한다.
  const lastTradingDay = rows[rows.length - 1]?.d ?? null;
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const dow = new Date(`${todayKst}T00:00:00Z`).getUTCDay();
  const marketClosedToday = dow === 0 || dow === 6;

  const probability = {
    lastTradingDay,
    todayKst,
    marketClosedToday,
    byHorizon: [1, 5, 21, 63, 252, 756, 1260].map(upRate),
    tomorrowByTemp: byTemp,
    tomorrowSpread: {
      min: Math.min(...byTemp.map((b) => b.pUp)),
      max: Math.max(...byTemp.map((b) => b.pUp)),
    },
  };

  const cost = {
    holdings: holdingStats(rows.map((r) => r.kospi)),
    medallionWinRate: MEDALLION_WIN_RATE,
    payoff: payoffSensitivity(),
    assumptions: {
      stockPct: Math.round(COST.stock * 10000) / 100,
      etfPct: Math.round(COST.etf * 10000) / 100,
    },
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
    gauges,
    range,
    probability,
    cost,
    myBucket,
    buckets,
    bucketCI,
    bootstrapMeta,
    indicators,
    dividend,
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
