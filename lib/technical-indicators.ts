/**
 * 가격만으로 계산하는 후행 추세 지표. (원안: 코덱스, scripts/verify_technical.py와 쌍)
 *
 * 설정은 결과를 보고 고르지 않고 보편적인 기본값으로 고정한다.
 * - 골든크로스: SMA 50/200
 * - MACD: EMA 12/26, signal EMA 9
 * - 볼린저 밴드: SMA 20 ± 2σ (모집단 표준편차, ÷N)
 * 이 값들은 교과서 기본값이며 성적을 보고 조정하지 않는다.
 * verify_technical.py가 매 push마다 이 상수를 대조해 임의 변경을 막는다.
 *
 * 이 모듈은 기존 '온도'의 정의나 후보 선택에 참여하지 않는다.
 *
 * ⚠️ 중복 고지 — 볼린저 오실레이터는 build-bootstrap.mjs의 %B(20,2)와
 * 같은 정보다. osc = (%B − 50) / 50 으로 정확히 환원된다(실측 오차 1.9e-14).
 * 여기서 새로 얻는 것은 지표가 아니라 1년이라는 기간이다.
 * 골든크로스는 5년 이격도와 상관 +0.635로 부분 중복, MACD만 대응이 없다.
 */

export const TECHNICAL_SETTINGS = Object.freeze({
  goldenCross: { short: 50, long: 200 },
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { window: 20, deviations: 2 },
  forwardDays: 252,
} as const);

type PriceRow = { d: string; kospi: number };

export type HistoricalState = {
  key: string;
  label: string;
  /** 겹치는 창의 관측 수. 독립 표본 수가 아니다 — independentN을 함께 볼 것. */
  n: number;
  /** n을 예측 기간으로 나눈 값. 1년 창은 364일이 겹치므로 실질 표본은 이쪽이다. */
  independentN: number;
  medianReturn: number;
  negativeRate: number;
};

export type FairScore = {
  n: number;
  hitRate: number;
  baselineAlwaysUp: number;
  edgeVsBaseline: number;
};

export type TechnicalSignal = {
  key: 'goldenCross' | 'macd' | 'bollinger';
  label: string;
  date: string;
  state: string;
  detail: string;
  oscillator: number;
  overlapWithFiveYearDeviation: number;
  history: HistoricalState[];
  fairScore: FairScore;
  values: Record<string, number>;
  settings: Record<string, number>;
};

export type TechnicalSignals = {
  asOf: string | null;
  note: string;
  commonEvaluationFrom: string | null;
  signals: TechnicalSignal[];
};

function round(n: number, digits = 2): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function sma(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function ema(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < window) return out;
  let seed = 0;
  for (let i = 0; i < window; i++) seed += values[i];
  let current = seed / window;
  out[window - 1] = current;
  const alpha = 2 / (window + 1);
  for (let i = window; i < values.length; i++) {
    current = alpha * values[i] + (1 - alpha) * current;
    out[i] = current;
  }
  return out;
}

function emaNullable(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  const first = values.findIndex((v) => v !== null);
  if (first < 0 || first + window > values.length) return out;
  let seed = 0;
  for (let i = first; i < first + window; i++) {
    if (values[i] === null) return out;
    seed += values[i]!;
  }
  let current = seed / window;
  out[first + window - 1] = current;
  const alpha = 2 / (window + 1);
  for (let i = first + window; i < values.length; i++) {
    if (values[i] === null) continue;
    current = alpha * values[i]! + (1 - alpha) * current;
    out[i] = current;
  }
  return out;
}

function correlation(a: (number | null)[], b: (number | null)[]): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === null || b[i] === null) continue;
    xs.push(a[i]!);
    ys.push(b[i]!);
  }
  if (xs.length < 3) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] - mx;
    const y = ys[i] - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  return dx === 0 || dy === 0 ? 0 : round(num / Math.sqrt(dx * dy), 3);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stateHistory(
  prices: number[],
  states: (string | null)[],
  labels: Record<string, string>,
): HistoricalState[] {
  const groups = new Map<string, number[]>();
  const h = TECHNICAL_SETTINGS.forwardDays;
  for (let i = 0; i + h < prices.length; i++) {
    const state = states[i];
    if (state === null) continue;
    if (!groups.has(state)) groups.set(state, []);
    groups.get(state)!.push(((prices[i + h] - prices[i]) / prices[i]) * 100);
  }
  return Object.keys(labels).flatMap((key) => {
    const values = groups.get(key) ?? [];
    if (values.length === 0) return [];
    return [{
      key,
      label: labels[key],
      n: values.length,
      independentN: Math.floor(values.length / h),
      medianReturn: round(quantile(values, 0.5), 1),
      negativeRate: round((values.filter((x) => x < 0).length / values.length) * 100, 1),
    }];
  });
}

function fairScore(
  prices: number[],
  oscillator: (number | null)[],
  commonStart: number,
): FairScore {
  const h = TECHNICAL_SETTINGS.forwardDays;
  let hits = 0;
  let ups = 0;
  let n = 0;
  for (let i = commonStart; i + h < prices.length; i += h) {
    if (oscillator[i] === null) continue;
    const actualUp = prices[i + h] >= prices[i];
    const predictedUp = oscillator[i]! >= 0;
    if (actualUp) ups++;
    if (actualUp === predictedUp) hits++;
    n++;
  }
  const hitRate = n === 0 ? 0 : round((hits / n) * 100, 1);
  const baseline = n === 0 ? 0 : round((ups / n) * 100, 1);
  return { n, hitRate, baselineAlwaysUp: baseline, edgeVsBaseline: round(hitRate - baseline, 1) };
}

export function computeTechnicalSignals(rows: PriceRow[]): TechnicalSignals {
  const sorted = [...rows].sort((a, b) => a.d.localeCompare(b.d));
  const prices = sorted.map((r) => r.kospi);
  if (prices.length < 200) {
    return { asOf: null, commonEvaluationFrom: null, note: '계산할 가격 기록이 부족합니다.', signals: [] };
  }

  const shortMa = sma(prices, TECHNICAL_SETTINGS.goldenCross.short);
  const longMa = sma(prices, TECHNICAL_SETTINGS.goldenCross.long);
  const goldenOsc = prices.map((_, i) =>
    shortMa[i] !== null && longMa[i] !== null ? ((shortMa[i]! - longMa[i]!) / longMa[i]!) * 100 : null,
  );
  const goldenStates = goldenOsc.map((x) => (x === null ? null : x >= 0 ? 'above' : 'below'));

  const fast = ema(prices, TECHNICAL_SETTINGS.macd.fast);
  const slow = ema(prices, TECHNICAL_SETTINGS.macd.slow);
  const macdLine = prices.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null);
  const signalLine = emaNullable(macdLine, TECHNICAL_SETTINGS.macd.signal);
  const macdHist = prices.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null ? macdLine[i]! - signalLine[i]! : null,
  );
  const macdStates = macdHist.map((x) => (x === null ? null : x >= 0 ? 'bullish' : 'bearish'));

  const middle = sma(prices, TECHNICAL_SETTINGS.bollinger.window);
  const upper: (number | null)[] = Array(prices.length).fill(null);
  const lower: (number | null)[] = Array(prices.length).fill(null);
  const bollOsc: (number | null)[] = Array(prices.length).fill(null);
  const bollStates: (string | null)[] = Array(prices.length).fill(null);
  for (let i = TECHNICAL_SETTINGS.bollinger.window - 1; i < prices.length; i++) {
    const mean = middle[i]!;
    let variance = 0;
    for (let j = i - TECHNICAL_SETTINGS.bollinger.window + 1; j <= i; j++) {
      variance += (prices[j] - mean) ** 2;
    }
    const sd = Math.sqrt(variance / TECHNICAL_SETTINGS.bollinger.window);
    upper[i] = mean + TECHNICAL_SETTINGS.bollinger.deviations * sd;
    lower[i] = mean - TECHNICAL_SETTINGS.bollinger.deviations * sd;
    bollOsc[i] = sd === 0 ? 0 : (prices[i] - mean) / (TECHNICAL_SETTINGS.bollinger.deviations * sd);
    bollStates[i] = prices[i] > upper[i]! ? 'above' : prices[i] < lower[i]! ? 'below' : prices[i] >= mean ? 'upperHalf' : 'lowerHalf';
  }

  // 기존 5년 이격도와 정보가 얼마나 겹치는지 일별 원시 오실레이터로 비교한다.
  const fiveYear = sma(prices, 1250).map((m, i) => m === null ? null : ((prices[i] - m) / m) * 100);
  const all = [goldenOsc, macdHist, bollOsc];
  let commonStart = 0;
  while (commonStart < prices.length && (fiveYear[commonStart] === null || all.some((s) => s[commonStart] === null))) commonStart++;
  const last = prices.length - 1;

  const goldenValue = goldenOsc[last]!;
  const macdValue = macdLine[last]!;
  const signalValue = signalLine[last]!;
  const bollValue = bollOsc[last]!;
  const bollPosition = lower[last] === upper[last] ? 50 : ((prices[last] - lower[last]!) / (upper[last]! - lower[last]!)) * 100;

  const signals: TechnicalSignal[] = [
    {
      key: 'goldenCross', label: '골든크로스', date: sorted[last].d,
      state: goldenValue >= 0 ? '골든크로스 상태' : '데드크로스 상태',
      detail: `50일선이 200일선보다 ${Math.abs(goldenValue).toFixed(1)}% ${goldenValue >= 0 ? '위' : '아래'}입니다.`,
      oscillator: round(goldenValue, 3), overlapWithFiveYearDeviation: correlation(goldenOsc, fiveYear),
      history: stateHistory(prices, goldenStates, { above: '50일선이 200일선 위', below: '50일선이 200일선 아래' }),
      fairScore: fairScore(prices, goldenOsc, commonStart),
      values: { shortMa: round(shortMa[last]!), longMa: round(longMa[last]!), spreadPct: round(goldenValue) },
      settings: { short: 50, long: 200 },
    },
    {
      key: 'macd', label: 'MACD', date: sorted[last].d,
      state: macdHist[last]! >= 0 ? '상승 동력 우세' : '하락 동력 우세',
      detail: `MACD선이 신호선보다 ${Math.abs(macdHist[last]!).toFixed(1)}p ${macdHist[last]! >= 0 ? '위' : '아래'}입니다.`,
      oscillator: round(macdHist[last]!, 3), overlapWithFiveYearDeviation: correlation(macdHist, fiveYear),
      history: stateHistory(prices, macdStates, { bullish: 'MACD가 신호선 위', bearish: 'MACD가 신호선 아래' }),
      fairScore: fairScore(prices, macdHist, commonStart),
      values: { macd: round(macdValue), signal: round(signalValue), histogram: round(macdHist[last]!) },
      settings: { fast: 12, slow: 26, signal: 9 },
    },
    {
      key: 'bollinger', label: '볼린저 밴드', date: sorted[last].d,
      state: bollStates[last] === 'above' ? '상단 밴드 밖' : bollStates[last] === 'below' ? '하단 밴드 밖' : bollValue >= 0 ? '밴드 상단부' : '밴드 하단부',
      detail: `20일 밴드의 ${bollPosition.toFixed(0)}% 지점입니다. 상단 돌파가 곧 하락을 뜻하지는 않습니다.`,
      oscillator: round(bollValue, 3), overlapWithFiveYearDeviation: correlation(bollOsc, fiveYear),
      history: stateHistory(prices, bollStates, { above: '상단 밴드 밖', upperHalf: '중심선~상단', lowerHalf: '하단~중심선', below: '하단 밴드 밖' }),
      fairScore: fairScore(prices, bollOsc, commonStart),
      values: { middle: round(middle[last]!), upper: round(upper[last]!), lower: round(lower[last]!), positionPct: round(bollPosition) },
      settings: { window: 20, deviations: 2 },
    },
  ];

  return {
    asOf: sorted[last].d,
    commonEvaluationFrom: commonStart < sorted.length ? sorted[commonStart].d : null,
    note:
      '세 지표는 모두 과거 가격으로 계산한 후행 지표입니다. 온도나 매매 추천에는 반영하지 않습니다. ' +
      'history의 n은 창이 겹치는 관측 수이므로 독립 표본 수가 아닙니다(independentN 참조). ' +
      'fairScore는 창이 겹치지 않게 252거래일씩 건너뛰어 센 것이라 표본이 30개대로 작습니다.',
    signals,
  };
}
