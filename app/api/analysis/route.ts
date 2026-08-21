import { NextResponse } from 'next/server';
import historyData from '@/data/market-history.json';
import { expandingPercentileSeries, type MarketRow } from '@/lib/thermometer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MA = 1250; // 5년

function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const d = Math.sqrt(dx * dy);
  return d === 0 ? 0 : Math.round((num / d) * 1000) / 1000;
}

/** 겹치지 않는 표본으로 horizon일 후 수익률 상관 */
function evaluate(rows: MarketRow[], scores: (number | null)[], horizon: number) {
  const xs: number[] = [], ys: number[] = [];
  let last = -Infinity;
  for (let i = 0; i + horizon < rows.length; i++) {
    if (scores[i] === null) continue;
    if (i - last < horizon) continue; // 창이 겹치지 않도록
    xs.push(scores[i]!);
    ys.push(((rows[i + horizon].kospi - rows[i].kospi) / rows[i].kospi) * 100);
    last = i;
  }
  return { correlation: corr(xs, ys), n: xs.length };
}

export async function GET() {
  const rows = (historyData as { rows: MarketRow[] }).rows;

  // 후보 1: 5년 이동평균 이격도 (현재 사용 중)
  const dev: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].kospi;
    if (i >= MA) sum -= rows[i - MA].kospi;
    dev.push(i >= MA - 1 ? (rows[i].kospi / (sum / MA) - 1) * 100 : null);
  }

  // 후보 2·3: PER, PBR
  const per = rows.map((r) => r.per ?? null);
  const pbr = rows.map((r) => r.pbr ?? null);

  // 후보 4: CAPE-lite — 지수 / 최근 5년 평균 주당순이익(지수/PER로 역산)
  const earnings = rows.map((r) => (r.per && r.per > 0 ? r.kospi / r.per : null));
  const cape: (number | null)[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i < MA - 1) { cape.push(null); continue; }
    let acc = 0, cnt = 0;
    for (let j = i - MA + 1; j <= i; j++) {
      const e = earnings[j];
      if (e !== null) { acc += e; cnt++; }
    }
    cape.push(cnt > MA * 0.6 ? rows[i].kospi / (acc / cnt) : null);
  }

  // 후보 5: 주식 위험 프리미엄 = 이익수익률(1/PER) - 국고채 금리
  //   거장들이 실제로 보는 것. 높을수록 주식이 후하게 보상 = 차갑다 → invert
  const erp = rows.map((r) =>
    r.per && r.per > 0 && r.kr10y !== null && r.kr10y !== undefined
      ? (100 / r.per) - r.kr10y
      : null,
  );

  const candidates: { key: string; label: string; raw: (number | null)[] }[] = [
    { key: 'dev', label: '5년평균 이격도 (현재)', raw: dev },
    { key: 'per', label: 'PER', raw: per },
    { key: 'pbr', label: 'PBR', raw: pbr },
    { key: 'cape', label: 'CAPE-lite(5년)', raw: cape },
    { key: 'erp', label: '위험프리미엄(1/PER-금리)', raw: erp },
  ];

  const horizons = [252, 504];

  // 각 후보 점수들이 서로 얼마나 겹치는가 (= 새 정보가 있는가)
  const scoreMap: Record<string, (number | null)[]> = {};
  for (const c of candidates)
    scoreMap[c.key] = expandingPercentileSeries(c.raw, { warmup: 750, invert: c.key === 'erp' });
  function pairCorr(a: string, b: string) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const x = scoreMap[a][i], y = scoreMap[b][i];
      if (x === null || y === null) continue;
      xs.push(x); ys.push(y);
    }
    return { correlation: corr(xs, ys), n: xs.length };
  }
  // 온도가 코스피 지수 자체와 얼마나 같은가 (일간 변화 기준)
  const tempVsKospiDaily = (() => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const a = scoreMap['dev'][i], b = scoreMap['dev'][i - 1];
      if (a === null || b === null) continue;
      xs.push(a - b);
      ys.push(((rows[i].kospi - rows[i - 1].kospi) / rows[i - 1].kospi) * 100);
    }
    return { correlation: corr(xs, ys), n: xs.length };
  })();

  // ── 상승 확률: 기간별 / 온도구간별 ───────────────────────────
  const devScore = scoreMap['dev'];
  function pUp(h: number) {
    let up = 0, n = 0;
    for (let i = 0; i + h < rows.length; i++) {
      if (rows[i + h].kospi > rows[i].kospi) up++;
      n++;
    }
    return { days: h, pUp: Math.round((up / n) * 1000) / 10, n, effectiveN: Math.round(n / h) };
  }
  function pUpByBucket(h: number, size = 20) {
    const m = new Map<number, { up: number; n: number }>();
    for (let i = 0; i + h < rows.length; i++) {
      const sc = devScore[i];
      if (sc === null) continue;
      const b = Math.min(Math.floor(sc / size), Math.ceil(100 / size) - 1);
      if (!m.has(b)) m.set(b, { up: 0, n: 0 });
      const e = m.get(b)!;
      if (rows[i + h].kospi > rows[i].kospi) e.up++;
      e.n++;
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, e]) => ({
      from: b * size, to: b * size + size,
      pUp: Math.round((e.up / e.n) * 1000) / 10, n: e.n,
    }));
  }

  return NextResponse.json({
    probability: {
      byHorizon: [1, 5, 21, 63, 252, 756, 1260].map(pUp),
      tomorrowByTemp: pUpByBucket(1),
      oneYearByTemp: pUpByBucket(252),
    },
    overlap: {
      'dev↔pbr': pairCorr('dev', 'pbr'),
      'dev↔per': pairCorr('dev', 'per'),
      'pbr↔per': pairCorr('pbr', 'per'),
      'dev↔cape': pairCorr('dev', 'cape'),
      'dev↔erp': pairCorr('dev', 'erp'),
      'pbr↔erp': pairCorr('pbr', 'erp'),
      온도일간변화_vs_코스피일간변화: tempVsKospiDaily,
    },
    result: candidates.map((c) => {
      const scores = scoreMap[c.key];
      const latestIdx = (() => {
        for (let i = scores.length - 1; i >= 0; i--) if (scores[i] !== null) return i;
        return -1;
      })();
      return {
        key: c.key,
        label: c.label,
        todayRaw: latestIdx >= 0 ? Math.round((c.raw[latestIdx] ?? 0) * 100) / 100 : null,
        todayScore: latestIdx >= 0 ? Math.round((scores[latestIdx] ?? 0) * 10) / 10 : null,
        firstValid: (() => {
          for (let i = 0; i < scores.length; i++) if (scores[i] !== null) return rows[i].d;
          return null;
        })(),
        byHorizon: horizons.map((h) => ({ years: h / 252, ...evaluate(rows, scores, h) })),
      };
    }),
  });
}
