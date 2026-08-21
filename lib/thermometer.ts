/**
 * 시장 온도계 — 계산 로직 (단일 소스)
 *
 * 원칙
 *  1) 예측하지 않는다. "지금 어디인가"만 판정한다.
 *  2) 각 시점의 점수는 그 시점까지의 데이터만 사용한다 (expanding window).
 *     → 역사 분포에 미래 정보가 새지 않는다.
 *  3) 결과는 점 추정이 아니라 분포로 제시한다.
 */

export type MarketRow = {
  d: string;
  kospi: number;
  vix: number | null;
  fx: number | null;
  y10: number | null;
  spread: number | null;
  expYoY: number | null;
  /** 코스피 지수 PER (KRX, 2001~) */
  per?: number | null;
  /** 코스피 지수 PBR (KRX, 2002.4~) */
  pbr?: number | null;
  /** 한국 국고채 장기금리 % (FRED INTGSBKRM193N) */
  kr10y?: number | null;
  /** 코스피 배당수익률 % (KRX, 2001~). 지수가 가격지수라 빠져 있는 몫 */
  dy?: number | null;
};

export type AxisKey = 'price' | 'fear' | 'fx' | 'rate' | 'real';

/**
 * 온도에 실제로 반영되는 축.
 *
 * 처음엔 5축 가중 평균(40/25/15/10/10)이었으나 근거 없는 가중치가 잡음을
 * 더하고 있어 하나만 남겼다.
 *
 * ⚠️ 왜 '이격도'인가 — 예측력 때문이 아니다.
 * 2차 검증에서 후보 비교 자체가 불공정했음이 드러났다. 후보마다 데이터
 * 시작일이 달라(이격도 1996, PBR 2005, CAPE 2007) 서로 다른 시장 국면을
 * 비교하고 있었다. 모든 후보가 존재하는 공통 기간(2007~, n=19)에서 다시
 * 재면 PBR(-0.303)이 이격도(-0.146)보다 낫다.
 *
 * 그럼에도 이격도를 쓰는 이유는 예측 성적이 아니라 다음 셋이다.
 *   1) 가장 긴 역사 (1996~). 30년 맥락을 줄 수 있는 유일한 축
 *   2) 외부 계정 없이 재현 가능 (PBR은 KRX 로그인 필요)
 *   3) 시민이 바로 이해할 수 있다 (5년 평균 대비 몇 %)
 * 이 선택은 사전 지정이며, 예측력 우위를 주장하지 않는다.
 */
export const TEMPERATURE_AXES: AxisKey[] = ['price'];
export const CONTEXT_AXES: AxisKey[] = ['fear', 'real', 'fx', 'rate'];

export const AXIS_WEIGHTS: Record<AxisKey, number> = {
  price: 100,
  fear: 0,
  real: 0,
  fx: 0,
  rate: 0,
};

export const AXIS_META: Record<AxisKey, { label: string; unit: string; hot: string; cold: string }> = {
  price: { label: '상승 폭', unit: '%', hot: '장기 추세보다 크게 위', cold: '장기 추세보다 크게 아래' },
  fear: { label: '심리', unit: '', hot: 'VIX 낮음 = 방심', cold: 'VIX 높음 = 공포' },
  real: { label: '실물', unit: '%', hot: '수출 증가', cold: '수출 감소' },
  fx: { label: '환율', unit: '원', hot: '원화 강세', cold: '원화 약세 = 자금 이탈 압력' },
  rate: { label: '금리', unit: '%', hot: '저금리 = 유동성 풍부', cold: '고금리 = 유동성 축소' },
};

const MA_WINDOW = 1250; // 약 5년 (거래일)
const WARMUP = 750; // 백분위 산출 최소 표본 (약 3년)
export const FORWARD_DAYS = 252; // 1년 후

/** value가 sample 안에서 차지하는 백분위 (0~100) */
function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

function insertSorted(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

export type AxisScore = { key: AxisKey; raw: number; score: number };

/**
 * 확장창 백분위 시계열.
 * i번째 값은 0..i-1 표본 안에서의 위치로만 환산한다 (미래 정보 차단).
 * warmup 미만 구간은 null.
 */
export function expandingPercentileSeries(
  values: (number | null)[],
  opts: { invert?: boolean; warmup?: number } = {},
): (number | null)[] {
  const warmup = opts.warmup ?? WARMUP;
  const sample: number[] = [];
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (sample.length < warmup) {
      insertSorted(sample, v);
      return null;
    }
    const pct = percentileRank(sample, v);
    insertSorted(sample, v);
    return opts.invert ? 100 - pct : pct;
  });
}

export type DayTemperature = {
  d: string;
  kospi: number;
  temp: number;
  axes: AxisScore[];
  inverted: boolean; // 장단기 금리 역전 여부
};

/**
 * 전체 시계열에 대해 온도를 계산한다.
 * 각 날짜의 백분위는 그 날짜까지의 표본만으로 산출 (lookahead 없음).
 */
export function computeTemperatureSeries(rows: MarketRow[]): DayTemperature[] {
  const sortedRows = [...rows].sort((a, b) => a.d.localeCompare(b.d));

  // 이격도 = 종가 / 5년 이동평균 - 1
  const deviations: (number | null)[] = [];
  let maSum = 0;
  for (let i = 0; i < sortedRows.length; i++) {
    maSum += sortedRows[i].kospi;
    if (i >= MA_WINDOW) maSum -= sortedRows[i - MA_WINDOW].kospi;
    if (i >= MA_WINDOW - 1) {
      const ma = maSum / MA_WINDOW;
      deviations.push(ma > 0 ? (sortedRows[i].kospi / ma - 1) * 100 : null);
    } else {
      deviations.push(null);
    }
  }

  const samples: Record<AxisKey, number[]> = { price: [], fear: [], fx: [], rate: [], real: [] };
  const out: DayTemperature[] = [];

  for (let i = 0; i < sortedRows.length; i++) {
    const r = sortedRows[i];
    const dev = deviations[i];

    const rawByAxis: Record<AxisKey, number | null> = {
      price: dev,
      fear: r.vix,
      fx: r.fx,
      rate: r.y10,
      real: r.expYoY,
    };

    // 뜨거움 방향: price·real은 값이 클수록 뜨겁고, fear·fx·rate는 값이 클수록 차갑다
    const invertAxis: Record<AxisKey, boolean> = {
      price: false,
      fear: true,
      fx: true,
      rate: true,
      real: false,
    };

    const axes: AxisScore[] = [];
    let weighted = 0;
    let usedWeight = 0;
    let ready = true;

    (Object.keys(AXIS_WEIGHTS) as AxisKey[]).forEach((key) => {
      // 온도에 실제로 쓰이는 축만 그날의 유효성을 좌우한다.
      // (맥락축은 가중치 0이므로 결측이어도 그날을 버릴 이유가 없다)
      const required = TEMPERATURE_AXES.includes(key);
      const raw = rawByAxis[key];
      if (raw === null || !Number.isFinite(raw)) {
        if (required) ready = false;
        return;
      }
      const sample = samples[key];
      if (sample.length < WARMUP) {
        insertSorted(sample, raw);
        if (required) ready = false;
        return;
      }
      const pct = percentileRank(sample, raw);
      const score = invertAxis[key] ? 100 - pct : pct;
      insertSorted(sample, raw);
      axes.push({ key, raw, score });
      if (TEMPERATURE_AXES.includes(key)) {
        weighted += score * AXIS_WEIGHTS[key];
        usedWeight += AXIS_WEIGHTS[key];
      }
    });

    if (!ready || usedWeight === 0) continue;

    out.push({
      d: r.d,
      kospi: r.kospi,
      temp: Math.round((weighted / usedWeight) * 10) / 10,
      axes,
      inverted: r.spread !== null && r.spread < 0,
    });
  }

  return out;
}

/**
 * 현재 관측값 하나의 온도를 과거 표본 기준으로 산출.
 * (역사 시리즈를 표본으로 삼되, 현재값은 표본에 넣지 않는다)
 */
export function computeCurrentTemperature(
  history: MarketRow[],
  current: MarketRow,
): DayTemperature | null {
  const merged = [...history.filter((r) => r.d < current.d), current];
  const series = computeTemperatureSeries(merged);
  const last = series[series.length - 1];
  return last && last.d === current.d ? last : null;
}

export type Bucket = {
  from: number;
  to: number;
  label: string;
  /** 구간에 속한 거래일 수. 1년 창이 겹치므로 이 숫자를 표본 크기로 읽으면 안 된다 */
  n: number;
  /** 겹침을 걷어낸 실질 독립 표본 (년 단위) */
  independentYears: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  negativeRate: number;
  mean: number;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 온도 구간별 "1년 후 수익률" 분포 */
export function buildBuckets(series: DayTemperature[], bucketSize = 20): Bucket[] {
  const byBucket = new Map<number, number[]>();

  for (let i = 0; i < series.length; i++) {
    const future = series[i + FORWARD_DAYS];
    if (!future) break; // 아직 1년이 지나지 않은 구간은 제외
    const ret = ((future.kospi - series[i].kospi) / series[i].kospi) * 100;
    const b = Math.min(Math.floor(series[i].temp / bucketSize), Math.ceil(100 / bucketSize) - 1);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b)!.push(ret);
  }

  const buckets: Bucket[] = [];
  for (const [b, list] of [...byBucket.entries()].sort((a, b2) => a[0] - b2[0])) {
    const sorted = [...list].sort((a, b2) => a - b2);
    const from = b * bucketSize;
    const to = from + bucketSize;
    buckets.push({
      from,
      to,
      label: temperatureLabel((from + to) / 2),
      n: sorted.length,
      independentYears: Math.round((sorted.length / FORWARD_DAYS) * 10) / 10,
      min: round1(sorted[0]),
      p25: round1(quantile(sorted, 0.25)),
      median: round1(quantile(sorted, 0.5)),
      p75: round1(quantile(sorted, 0.75)),
      max: round1(sorted[sorted.length - 1]),
      negativeRate: round1((sorted.filter((x) => x < 0).length / sorted.length) * 100),
      mean: round1(sorted.reduce((s, x) => s + x, 0) / sorted.length),
    });
  }
  return buckets;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 온도와 1년 후 수익률의 상관계수 — 이 지표가 실제로 의미가 있는지 자체 검증 */
export function temperatureReturnCorrelation(series: DayTemperature[]): {
  correlation: number;
  n: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const future = series[i + FORWARD_DAYS];
    if (!future) break;
    xs.push(series[i].temp);
    ys.push(((future.kospi - series[i].kospi) / series[i].kospi) * 100);
  }
  const n = xs.length;
  if (n < 2) return { correlation: 0, n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return { correlation: denom === 0 ? 0 : Math.round((num / denom) * 1000) / 1000, n };
}

/**
 * 라벨은 '예측'이 아니라 '위치'를 가리키는 말로 쓴다.
 * (과열 → 과열권: 떨어진다는 뜻이 아니라 높이 올라와 있다는 뜻)
 */
export function temperatureLabel(temp: number): string {
  if (temp >= 80) return '과열권';
  if (temp >= 60) return '상단권';
  if (temp >= 40) return '중립';
  if (temp >= 20) return '냉각권';
  return '공포권';
}

export function temperatureQuote(temp: number): { who: string; line: string } {
  if (temp >= 80)
    return { who: '워런 버핏', line: '남들이 탐욕스러울 때 두려워하라.' };
  if (temp >= 60)
    return { who: '하워드 마크스', line: '사이클의 어디에 있는지 아는 것만으로 절반은 온 것이다.' };
  if (temp >= 40)
    return { who: '하워드 마크스', line: '우리는 예측할 수 없다. 다만 준비할 수 있다.' };
  if (temp >= 20)
    return { who: '피터 린치', line: '하락은 언제나 온다. 준비된 사람에게는 기회가 된다.' };
  return { who: '워런 버핏', line: '남들이 두려워할 때 탐욕스러워져라.' };
}

/**
 * 정직한 검증 — 겹치지 않는 표본만 사용.
 *
 * 일별로 1년 후 수익률을 계산하면 창이 364일씩 겹쳐서
 * 표본 수가 실제보다 250배 부풀려진다. stride(=252거래일)만큼
 * 건너뛰며 뽑으면 서로 독립에 가까운 표본이 된다.
 */
export function nonOverlappingValidation(
  series: DayTemperature[],
  stride = FORWARD_DAYS,
): { correlation: number; n: number; points: { d: string; temp: number; forwardReturn: number }[] } {
  const points: { d: string; temp: number; forwardReturn: number }[] = [];
  for (let i = 0; i + FORWARD_DAYS < series.length; i += stride) {
    const now = series[i];
    const future = series[i + FORWARD_DAYS];
    points.push({
      d: now.d,
      temp: now.temp,
      forwardReturn: Math.round(((future.kospi - now.kospi) / now.kospi) * 1000) / 10,
    });
  }
  const n = points.length;
  if (n < 3) return { correlation: 0, n, points };
  const mx = points.reduce((s, p) => s + p.temp, 0) / n;
  const my = points.reduce((s, p) => s + p.forwardReturn, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const p of points) {
    const a = p.temp - mx;
    const b = p.forwardReturn - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return { correlation: denom === 0 ? 0 : Math.round((num / denom) * 1000) / 1000, n, points };
}

export type ScorecardEntry = {
  d: string;
  temp: number;
  expectedMedian: number;
  expectedNegRate: number;
  actualReturn: number;
  directionHit: boolean;
};

export type Scorecard = {
  entries: ScorecardEntry[];
  n: number;
  hitRate: number;
  /**
   * 같은 평가 시점들에서 실제로 1년 뒤 올랐던 비율.
   * 1년 지평의 올바른 기준선은 50%가 아니라 이 값이다. 주식시장에는
   * 상승 편향이 있어서, 아무 분석 없이 "오른다"고만 해도 이만큼 맞는다.
   */
  baselineAlwaysUp: number;
  /** 기준선 대비 몇 %p. 음수면 분석이 오히려 해가 됐다는 뜻 */
  edgeVsBaseline: number;
  meanAbsError: number;
};

/**
 * 워크포워드 자기 채점.
 *
 * 각 평가 시점 i에서
 *   - 학습 표본: series[0 .. i-FORWARD_DAYS]  (그 시점에 이미 1년 결과가 나와 있던 구간)
 *   - 예상치: 그 표본으로 만든 온도구간의 중앙값
 *   - 실제: series[i+FORWARD_DAYS]의 수익률
 * 미래 정보를 일절 쓰지 않는다. 지표가 실전에서 어땠을지를 그대로 재현한다.
 */
export function walkForwardScorecard(
  series: DayTemperature[],
  opts: { stride?: number; minTrain?: number; bucketSize?: number } = {},
): Scorecard {
  const stride = opts.stride ?? 21; // 약 월 1회 평가
  const minTrain = opts.minTrain ?? 750;
  const bucketSize = opts.bucketSize ?? 20;

  const entries: ScorecardEntry[] = [];

  for (let i = 0; i + FORWARD_DAYS < series.length; i += stride) {
    const trainEnd = i - FORWARD_DAYS;
    if (trainEnd < minTrain) continue;

    const train = series.slice(0, trainEnd);
    const buckets = buildBuckets(train, bucketSize);
    const temp = series[i].temp;
    const b = buckets.find((x) => temp >= x.from && temp < x.to);
    if (!b || b.n < 20) continue;

    const actual =
      ((series[i + FORWARD_DAYS].kospi - series[i].kospi) / series[i].kospi) * 100;

    entries.push({
      d: series[i].d,
      temp,
      expectedMedian: b.median,
      expectedNegRate: b.negativeRate,
      actualReturn: Math.round(actual * 10) / 10,
      directionHit: (b.median >= 0) === (actual >= 0),
    });
  }

  const n = entries.length;
  const hits = entries.filter((e) => e.directionHit).length;
  const hitRate = n === 0 ? 0 : Math.round((hits / n) * 1000) / 10;
  const ups = entries.filter((e) => e.actualReturn >= 0).length;
  const baselineAlwaysUp = n === 0 ? 0 : Math.round((ups / n) * 1000) / 10;
  const mae =
    n === 0
      ? 0
      : Math.round(
          (entries.reduce((s, e) => s + Math.abs(e.actualReturn - e.expectedMedian), 0) / n) * 10,
        ) / 10;

  return {
    entries,
    n,
    hitRate,
    baselineAlwaysUp,
    edgeVsBaseline: Math.round((hitRate - baselineAlwaysUp) * 10) / 10,
    meanAbsError: mae,
  };
}


/* ────────────────────────────────────────────────────────────────
 * 블록 부트스트랩 — 구간 통계의 불확실성
 *
 * 1년 창이 364일씩 겹치므로 각 구간의 중앙값·손실확률을 점 추정으로
 * 제시하면 실제보다 정밀해 보인다. 시간 구조를 보존하는 이동블록
 * 부트스트랩으로 신뢰구간을 구한다.
 * ──────────────────────────────────────────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BucketCI = {
  from: number;
  to: number;
  medianLow: number;
  medianHigh: number;
  negLow: number;
  negHigh: number;
  /** 중앙값의 부호가 신뢰구간 안에서 확정되는가 */
  signCertain: boolean;
};

/**
 * @deprecated 런타임에서 쓰지 말 것. 400회로는 몬테카를로 오차가 커서
 * '부호 확정' 판정이 시드에 따라 뒤집힌다(2차 검증). 운영은
 * scripts/build-bootstrap.mjs가 10,000회 × 블록 3종으로 미리 계산한
 * data/bootstrap.json을 읽는다.
 */
export function bucketBootstrap(
  series: DayTemperature[],
  opts: { bucketSize?: number; reps?: number; block?: number; seed?: number } = {},
): BucketCI[] {
  const size = opts.bucketSize ?? 20;
  const reps = opts.reps ?? 400;
  const block = opts.block ?? FORWARD_DAYS;
  const rand = mulberry32(opts.seed ?? 20260822);
  const count = Math.ceil(100 / size);

  const pairs: { b: number; ret: number }[] = [];
  for (let i = 0; i + FORWARD_DAYS < series.length; i++) {
    const b = Math.min(Math.floor(series[i].temp / size), count - 1);
    pairs.push({ b, ret: ((series[i + FORWARD_DAYS].kospi - series[i].kospi) / series[i].kospi) * 100 });
  }
  const n = pairs.length;
  if (n < block * 2) return [];

  const meds: number[][] = Array.from({ length: count }, () => []);
  const negs: number[][] = Array.from({ length: count }, () => []);

  for (let r = 0; r < reps; r++) {
    const groups: number[][] = Array.from({ length: count }, () => []);
    let filled = 0;
    while (filled < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < block && filled < n; k++, filled++) {
        const p = pairs[(start + k) % n];
        groups[p.b].push(p.ret);
      }
    }
    for (let b = 0; b < count; b++) {
      const g = groups[b];
      if (g.length < 20) continue;
      g.sort((x, y) => x - y);
      meds[b].push(quantile(g, 0.5));
      negs[b].push((g.filter((x) => x < 0).length / g.length) * 100);
    }
  }

  const out: BucketCI[] = [];
  for (let b = 0; b < count; b++) {
    if (meds[b].length < 20) continue;
    meds[b].sort((x, y) => x - y);
    negs[b].sort((x, y) => x - y);
    const lo = quantile(meds[b], 0.025);
    const hi = quantile(meds[b], 0.975);
    out.push({
      from: b * size,
      to: b * size + size,
      medianLow: round1(lo),
      medianHigh: round1(hi),
      negLow: round1(quantile(negs[b], 0.025)),
      negHigh: round1(quantile(negs[b], 0.975)),
      signCertain: lo > 0 || hi < 0,
    });
  }
  return out;
}

/** 코스피는 가격지수라 배당이 빠져 있다. 실제 투자 수익은 이만큼 더 높았다 */
export function averageDividendYield(rows: MarketRow[]): { avg: number; from: string | null } {
  const vals: number[] = [];
  let from: string | null = null;
  for (const r of rows) {
    if (r.dy !== null && r.dy !== undefined && r.dy > 0) {
      if (from === null) from = r.d;
      vals.push(r.dy);
    }
  }
  if (vals.length === 0) return { avg: 0, from: null };
  return { avg: Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100) / 100, from };
}
