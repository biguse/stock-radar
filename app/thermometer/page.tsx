'use client';

import { useEffect, useState } from 'react';

type Gauge = {
  key: string;
  label: string;
  question: string;
  raw: number;
  rawText: string;
  score: number;
  date: string;
};

type Bucket = {
  from: number; to: number; n: number; independentYears: number;
  min: number; median: number; max: number; negativeRate: number;
};

type Probability = {
  lastTradingDay: string | null;
  todayKst: string;
  marketClosedToday: boolean;
  byHorizon: { days: number; pUp: number; n: number; independent: number }[];
  tomorrowByTemp: { from: number; to: number; pUp: number; n: number }[];
  tomorrowSpread: { min: number; max: number };
};

type HoldingStat = {
  days: number; label: string; winRate: number;
  avgGain: number; avgLoss: number;
  breakEvenStock: number; breakEvenEtf: number; edgeStock: number;
  annualCostStock: number; annualCostEtf: number; annualDrawdownStock: number;
};

type PayoffCase = { label: string; gain: number; loss: number; breakEven: number };

type CostInfo = {
  holdings: HoldingStat[];
  medallionWinRate: number;
  payoff: PayoffCase[];
  assumptions: { stockPct: number; etfPct: number };
};

type BucketCI = {
  from: number; to: number;
  medianLow: number; medianHigh: number;
  negLow: number; negHigh: number;
  signCertain: boolean;
  validReps: number;
};

type BootstrapMeta = {
  reps: number; blocks: number[]; primaryBlock: number;
  builtAt: string; uncertainRange: number[];
};

type Indicator = {
  key: string; label: string; note: string;
  rates: (number | null)[]; n: number; base: number; topRate: number; z: number;
};

type ApiResponse = {
  indicators?: Indicator[];
  bucketCI?: BucketCI[];
  bootstrapMeta?: BootstrapMeta;
  dividend?: { avg: number; from: string | null };
  cost?: CostInfo;
  probability?: Probability;
  current: { date: string; kospi: number; temp: number; label: string; quote: { who: string; line: string } } | null;
  gauges: Gauge[];
  range: { min: number; max: number; median: number; spread: number } | null;
  myBucket: Bucket | null;
  coverage: { from: string | null; to: string | null };
  honest: { correlation: number; n: number };
  scorecard: {
    n: number; hitRate: number;
    baselineAlwaysUp: number; edgeVsBaseline: number;
    meanAbsError: number;
  };
  error?: string;
};

function tempColor(t: number): string {
  if (t >= 80) return '#b91c1c';
  if (t >= 60) return '#c2410c';
  if (t >= 40) return '#57534e';
  if (t >= 20) return '#0369a1';
  return '#047857';
}

function zoneName(t: number): string {
  if (t >= 80) return '과열권';
  if (t >= 60) return '상단권';
  if (t >= 40) return '중립';
  if (t >= 20) return '냉각권';
  return '공포권';
}

/** 네 잣대가 얼마나 같은 말을 하는지 한 문장으로 */
function verdict(range: { min: number; max: number; spread: number }): string {
  const { min, max, spread } = range;
  if (min >= 80) return '네 잣대가 모두 과열권을 가리킵니다.';
  if (max <= 20) return '네 잣대가 모두 공포권을 가리킵니다.';
  if (spread > 40) return '잣대에 따라 정반대에 가깝게 갈립니다. 지금은 누구의 확신도 믿기 어렵습니다.';
  if (min >= 60) return `어느 잣대로 재도 상단권 이상입니다. 다만 얼마나 뜨거운지는 ${zoneName(min)}에서 ${zoneName(max)}까지 갈립니다.`;
  if (max <= 40) return '어느 잣대로 재도 하단권입니다.';
  return `잣대에 따라 ${zoneName(min)}에서 ${zoneName(max)}까지 갈립니다.`;
}

export default function ThermometerPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/thermometer', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as ApiResponse | null;
        if (!res.ok || !json || json.error || !json.current || !json.range) {
          setErr(json?.error ?? `HTTP ${res.status}`);
          setState('error');
        } else {
          setData(json);
          setState('ok');
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'unknown');
        setState('error');
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <main className="mx-auto max-w-xl px-6 pb-20 pt-14">
        <header className="text-center">
          <h1 className="text-[2.4rem] font-bold leading-none tracking-tight">시장 온도계</h1>
          <p className="mx-auto mt-4 max-w-[19rem] text-[14px] leading-relaxed text-neutral-500">
            시장이 지금 어디에 있는지,<br />
            그리고 그게 <span className="font-semibold text-neutral-900">무엇을 뜻하지 않는지</span>.
          </p>
        </header>

        {state === 'loading' ? (
          <p className="mt-20 text-center text-sm text-neutral-400">계산하는 중…</p>
        ) : state === 'error' ? (
          <p className="mt-20 text-center text-sm text-red-700">불러오지 못했습니다 — {err}</p>
        ) : data && data.current && data.range && data.myBucket ? (
          <>
            <Headline
              range={data.range}
              current={data.current}
              gauges={data.gauges}
              bucket={data.myBucket}
              bucketCI={data.bucketCI?.find((c) => c.from === data.myBucket?.from)}
            />
            <Gauges gauges={data.gauges} kospi={data.current.kospi} />
            <Tomorrow probability={data.probability} />
            <BreakEven cost={data.cost} />
            <Indicators indicators={data.indicators} cost={data.cost} />
            <Dividend dividend={data.dividend} />
            <Quote quote={data.current.quote} />
            <Outcome
              bucket={data.myBucket}
              trendScore={data.gauges.find((g) => g.key === 'trend')?.score ?? 0}
              ci={data.bucketCI?.find((c) => c.from === data.myBucket?.from)}
              meta={data.bootstrapMeta}
            />
            <Honesty data={data} />
            <HowItWasMade />
            <Footer data={data} />
          </>
        ) : null}
      </main>
    </div>
  );
}

/**
 * 헤드라인.
 * "증시가 높다"는 차트만 봐도 아는 뻔한 사실이라 부제로 내리고,
 * 사람들이 모르는 사실 — 그 자리가 무엇을 뜻하지 않는지 — 을 본문에 올린다.
 */
function headlineState(range: { min: number; max: number }): string {
  const { min, max } = range;
  if (min >= 90) return '지금 한국 증시는 30년 기록 중 거의 최고 자리에 있습니다';
  if (min >= 80) return '지금 한국 증시는 30년 기록 중 가장 높은 축에 있습니다';
  if (min >= 60) return '지금 한국 증시는 역사적으로 높은 자리에 있습니다';
  if (max <= 10) return '지금 한국 증시는 30년 기록 중 거의 최저 자리에 있습니다';
  if (max <= 20) return '지금 한국 증시는 30년 기록 중 가장 낮은 축에 있습니다';
  if (max <= 40) return '지금 한국 증시는 역사적으로 낮은 자리에 있습니다';
  if (max - min > 40) return '지금 시장은 잣대마다 답이 크게 엇갈립니다';
  return '지금 한국 증시는 중간쯤에 있습니다';
}

/**
 * 뻔하지 않은 쪽 — 그 자리가 무엇을 뜻하는가.
 * 블록 부트스트랩 신뢰구간이 넓으면 점 추정을 주장하지 않는다.
 */
function headlineTwist(bucket: Bucket, ci?: BucketCI): { main: string; sub: string } {
  const neg = bucket.negativeRate;
  // 신뢰구간을 못 구했으면 단정하지 않는다(fail-safe). 계산 실패가
  // 강한 점 추정 문구로 되돌아가면 안 된다.
  if (ci === undefined) {
    return {
      main: '그런데 그 자리가 무엇을 뜻하는지는\n확인 중입니다',
      sub: `과거 같은 구간의 1년 뒤 손실 확률은 ${neg.toFixed(0)}%로 계산되지만, 불확실성 구간을 아직 확인하지 못했습니다`,
    };
  }
  const wide = !ci.signCertain || ci.negHigh - ci.negLow > 40;
  if (wide) {
    return {
      main: '그런데 그 자리가 무엇을 뜻하는지는\n데이터가 답하지 못합니다',
      sub: `과거 같은 구간의 1년 뒤 손실 확률은 ${neg.toFixed(0)}%로 계산되지만, 표본이 겹쳐 있어 실제로는 ${ci.negLow.toFixed(0)}~${ci.negHigh.toFixed(0)}% 사이 어디든 될 수 있습니다`,
    };
  }
  const spread = `${bucket.min.toFixed(0)}%부터 +${bucket.max.toFixed(0)}%까지 갈렸습니다`;
  if (neg >= 45 && neg <= 55)
    return {
      main: '그런데 과거 같은 자리에서\n1년 뒤 결과는 반반이었습니다',
      sub: `손실로 끝난 경우 ${neg.toFixed(0)}% · ${spread}`,
    };
  if (neg > 55)
    return {
      main: '그리고 과거 같은 자리에서는\n1년 뒤 손실이 더 많았습니다',
      sub: `손실로 끝난 경우 ${neg.toFixed(0)}% · ${spread}`,
    };
  return {
    main: '그리고 과거 같은 자리에서는\n1년 뒤 오른 경우가 더 많았습니다',
    sub: `손실로 끝난 경우 ${neg.toFixed(0)}% · ${spread}`,
  };
}

function Headline({
  range,
  current,
  gauges,
  bucket,
  bucketCI,
}: {
  range: NonNullable<ApiResponse['range']>;
  current: NonNullable<ApiResponse['current']>;
  gauges: Gauge[];
  bucket: Bucket | null;
  bucketCI?: BucketCI;
}) {
  const [y, m, d] = current.date.split('-');
  const state = headlineState(range);
  const twist = bucket ? headlineTwist(bucket, bucketCI) : null;

  return (
    <section className="mt-12">
      <p className="text-center text-[14px] leading-relaxed text-neutral-500">{state}.</p>

      {twist ? (
        <>
          <h2 className="mt-3 whitespace-pre-line text-center text-[1.7rem] font-bold leading-[1.35] tracking-tight text-neutral-900">
            {twist.main}
          </h2>
          <p className="mt-3 text-center text-[13px] text-neutral-500">{twist.sub}</p>
        </>
      ) : (
        <h2 className="mt-3 text-center text-[1.7rem] font-bold leading-[1.35] tracking-tight text-neutral-900">
          {state}
        </h2>
      )}

      {/* 네 잣대의 위치를 한 줄에 겹쳐 보여준다 */}
      <div className="relative mt-9 h-8">
        <div className="absolute top-[14px] h-[3px] w-full bg-neutral-200" />
        {gauges.map((g) => (
          <div
            key={g.key}
            className="absolute top-[8px] h-[15px] w-[15px] rounded-full border-2 border-white"
            style={{
              left: `${Math.max(0, Math.min(100, g.score))}%`,
              background: tempColor(g.score),
              transform: 'translateX(-50%)',
            }}
            title={`${g.label} ${g.score.toFixed(0)}점`}
          />
        ))}
        <div className="absolute top-0 text-[10px] text-neutral-400">0 공포</div>
        <div className="absolute right-0 top-0 text-[10px] text-neutral-400">과열 100</div>
      </div>

      <p className="mt-4 text-center text-[13px] leading-relaxed text-neutral-500">
        네 잣대가 모두 {range.min >= 60 ? '상단권 이상' : range.max <= 40 ? '하단권' : '중간 부근'}을
        가리킵니다. 가장 낮게 본 잣대가 {range.min.toFixed(0)}점, 가장 높게 본 잣대가{' '}
        {range.max.toFixed(0)}점입니다.
      </p>

      <p className="mt-6 text-center text-[13px] text-neutral-400">
        코스피 {current.kospi.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} · {y}년 {Number(m)}월{' '}
        {Number(d)}일
      </p>
    </section>
  );
}

type Explain = { means: string; score: string; why: string; limit: string };

function explain(g: Gauge, kospi: number): Explain {
  switch (g.key) {
    case 'trend':
      return {
        means: `지금 코스피 ${Math.round(kospi).toLocaleString('ko-KR')}는 최근 5년 평균의 약 ${(1 + g.raw / 100).toFixed(1)}배 수준입니다.`,
        score: `${g.score.toFixed(0)}점은, 지난 30년 중 이보다 더 가파르게 올라와 있던 날이 ${(100 - g.score).toFixed(0)}%뿐이었다는 뜻입니다.`,
        why: '시장이 평소 다니던 자리에서 얼마나 멀리 왔는지 봅니다.',
        limit: '주가만 봅니다. 기업 이익이 함께 늘었다면 높이 올라온 것이 곧 비싼 것은 아닙니다.',
      };
    case 'pbr':
      return {
        means: `상장기업들이 가진 순자산의 약 ${g.raw.toFixed(1)}배 가격에 거래되고 있다는 뜻입니다. 1배면 장부에 적힌 값과 같은 가격입니다.`,
        score: `${g.score.toFixed(0)}점은, 2002년 이후 이보다 비쌌던 적이 거의 없다는 뜻입니다. 한국 증시는 오랫동안 1배 안팎에 머물렀습니다.`,
        why: '이익은 해마다 출렁이지만 자산은 천천히 변합니다. 그래서 값이 과했는지 볼 때 비교적 덜 흔들리는 잣대입니다.',
        limit: '공장·부동산이 많은 기업에는 잘 맞지만, 가진 자산이 적은 기술기업에는 덜 맞습니다.',
      };
    case 'per':
      return {
        means: `지금 가격이 기업들이 한 해 버는 순이익의 약 ${g.raw.toFixed(0)}배라는 뜻입니다. 이익이 지금 그대로라면 원금을 회수하는 데 ${g.raw.toFixed(0)}년이 걸립니다.`,
        score: `${g.score.toFixed(0)}점으로 높은 편이지만 극단은 아닙니다. 주가가 올랐지만 기업 이익도 함께 크게 늘어 나눗셈의 아래쪽이 커졌기 때문입니다.`,
        why: '결국 주식의 값어치는 그 기업이 벌어들이는 돈에서 나옵니다.',
        limit: '불황이 오면 이익이 먼저 급감해 PER이 치솟습니다. 가장 쌀 때 가장 비싸 보이는 함정이 있습니다.',
      };
    case 'erp':
      return {
        means: `주식에 기대할 수 있는 수익률이 국고채 금리보다 ${g.raw.toFixed(2)}%p 높다는 뜻입니다. 위험을 감수하는 대가가 그만큼이라는 얘기입니다.`,
        score: `${g.score.toFixed(0)}점은, 그 대가가 역사적으로 얇은 편이라는 뜻입니다. 예금이나 채권에 견주면 주식의 매력이 그만큼 줄었습니다.`,
        why: '하워드 마크스 같은 투자자들이 “지금 위험값을 제대로 쳐주고 있나”를 따질 때 쓰는 방식입니다. 가격의 높낮이가 아니라 대가를 봅니다.',
        limit: '금리가 출렁이면 같이 흔들립니다. 앞으로 벌 이익이 아니라 이미 번 이익으로 계산한다는 점도 감안해야 합니다.',
      };
    default:
      return { means: '', score: '', why: '', limit: '' };
  }
}

function Gauges({ gauges, kospi }: { gauges: Gauge[]; kospi: number }) {
  return (
    <section className="mt-11">
      <div className="space-y-5">
        {gauges.map((g) => {
          const e = explain(g, kospi);
          return (
            <div key={g.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold text-neutral-900">{g.label}</span>
                <span className="text-[13px] tabular-nums text-neutral-500">
                  {g.rawText}
                  <span className="ml-2 font-bold" style={{ color: tempColor(g.score) }}>
                    {g.score.toFixed(0)}
                  </span>
                </span>
              </div>
              <div className="relative mt-2 h-[10px]">
                <div className="absolute top-[4px] h-[2px] w-full bg-neutral-200" />
                <div
                  className="absolute top-0 h-[10px] w-[10px] rounded-full"
                  style={{
                    left: `${Math.max(0, Math.min(100, g.score))}%`,
                    background: tempColor(g.score),
                    transform: 'translateX(-50%)',
                  }}
                />
              </div>
              <details className="group mt-1.5">
                <summary className="cursor-pointer list-none text-[11px] leading-relaxed text-neutral-400 hover:text-neutral-600">
                  {g.question}
                  <span className="ml-1 text-neutral-300 group-open:hidden">· 자세히</span>
                </summary>
                <div className="mt-3 space-y-2 border-l-2 border-neutral-200 pl-4 text-[12px] leading-relaxed">
                  <p className="text-neutral-800">
                    <strong className="font-semibold">무슨 뜻이냐면</strong> {e.means}
                  </p>
                  <p className="text-neutral-600">
                    <strong className="font-semibold text-neutral-800">{g.score.toFixed(0)}점인 이유</strong>{' '}
                    {e.score}
                  </p>
                  <p className="text-neutral-600">
                    <strong className="font-semibold text-neutral-800">왜 보나</strong> {e.why}
                  </p>
                  <p className="text-neutral-500">
                    <strong className="font-semibold text-neutral-700">한계</strong> {e.limit}
                  </p>
                </div>
              </details>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex justify-between text-[10px] text-neutral-400">
        <span>0 공포</span>
        <span>50 중립</span>
        <span>과열 100</span>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-neutral-400">
        네 잣대를 모두 <strong className="font-medium text-neutral-500">0~100점</strong>으로 바꿔 나란히
        놓았습니다. 점수는 지금 값이 과거 기록에서 몇 번째로 뜨거운 축이냐를 나타냅니다. 90점이면 과거 90%의 날보다
        뜨겁다는 뜻이지, 값 자체가 크다는 뜻은 아닙니다.
      </p>
    </section>
  );
}

const HORIZON_LABEL: Record<number, string> = {
  1: '다음 거래일', 5: '1주 뒤', 21: '1개월 뒤', 63: '3개월 뒤',
  252: '1년 뒤', 756: '3년 뒤', 1260: '5년 뒤',
};

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function withDow(iso: string): string {
  const [y, m, d] = iso.split('-');
  const dow = DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${y}년 ${Number(m)}월 ${Number(d)}일 ${dow}요일`;
}

function Tomorrow({ probability }: { probability?: Probability }) {
  if (!probability) return null;
  const tomorrow = probability.byHorizon.find((h) => h.days === 1);
  const fiveYear = probability.byHorizon.find((h) => h.days === 1260);
  if (!tomorrow) return null;
  const { min, max } = probability.tomorrowSpread;
  const up = Math.round(tomorrow.pUp);
  const down = 100 - up;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[1.45rem] font-bold leading-[1.4] tracking-tight text-neutral-900">
        내일은 아무도 모릅니다
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-700">
        지난 30년 코스피를 하루 단위로{' '}
        <strong className="font-semibold">{tomorrow.n.toLocaleString('ko-KR')}번</strong> 세어봤습니다.
        오른 날이 <strong className="font-semibold">{up}번</strong>, 내린 날이{' '}
        <strong className="font-semibold">{down}번</strong>. 100번 중 {up - down}번 차이입니다.
      </p>

      <div className="mt-6">
        <div className="flex h-[46px] w-full overflow-hidden text-[12px] font-semibold text-white">
          <div className="flex h-full items-center justify-center bg-neutral-800" style={{ width: `${up}%` }}>
            올랐다 {up}
          </div>
          <div
            className="flex h-full items-center justify-center bg-neutral-300 text-neutral-700"
            style={{ width: `${down}%` }}
          >
            내렸다 {down}
          </div>
        </div>
        <p className="mt-2 text-center text-[13px] font-medium text-neutral-500">사실상 동전 던지기입니다</p>
      </div>

      <p className="mt-7 text-[15px] leading-relaxed text-neutral-800">
        그리고 오늘이 공포권이든 과열권이든, 이 숫자는{' '}
        <strong className="font-semibold">{min}%에서 {max}% 사이</strong>를 벗어나지 않습니다.{' '}
        <strong className="font-semibold">위에서 본 네 잣대 모두 내일 일은 알려주지 못합니다.</strong>
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
        내일 오를 종목을 알려주는 곳은 많습니다. 그 예측이 30년 기록에서 어떤 근거를 갖는지 보여주는
        곳은 드뭅니다. 이 페이지는 그걸 하려고 만들었습니다.
      </p>

      <div className="mt-10 border-t border-neutral-200 pt-7">
        <h3 className="text-[1.45rem] font-bold leading-[1.4] tracking-tight text-neutral-900">
          바뀌는 건 기간뿐입니다
        </h3>
        <div className="mt-5 space-y-2">
          {probability.byHorizon.map((h) => {
            const u = Math.round(h.pUp);
            return (
              <div key={h.days} className="flex items-center gap-3">
                <div className="w-[66px] shrink-0 whitespace-nowrap text-[12px] text-neutral-500">
                  {HORIZON_LABEL[h.days]}
                </div>
                <div className="flex h-[18px] flex-1 overflow-hidden">
                  <div className="h-full bg-neutral-800" style={{ width: `${u}%` }} />
                  <div className="h-full bg-neutral-200" style={{ width: `${100 - u}%` }} />
                </div>
                <div className="w-[58px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-neutral-900">
                  {u} : {100 - u}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-neutral-400">진한 쪽이 오른 비율, 옅은 쪽이 내린 비율입니다.</p>

        {fiveYear ? (
          <p className="mt-6 text-[16px] leading-relaxed text-neutral-800">
            하루를 맞히려 하면 <strong className="font-semibold">{up}대 {down}</strong>, 거의 동전입니다.
            5년을 기다린 경우에는 <strong className="font-semibold">{Math.round(fiveYear.pUp)}대{' '}
            {100 - Math.round(fiveYear.pUp)}</strong>였습니다.
          </p>
        ) : null}
        <p className="mt-3 text-[12px] leading-relaxed text-neutral-400">
          단, 3년·5년 수치는 겹치는 구간을 세었기 때문에 독립 표본이 각각 12회·7회뿐입니다. 방향은
          분명하지만 정확한 숫자로 받아들이지는 마세요. 반대로 맨 위 하루 수치는 9,452번이 모두 겹치지
          않아, 이 페이지에서 가장 믿을 만한 숫자입니다.
        </p>
      </div>

      {probability.lastTradingDay ? (
        <p className="mt-8 text-[11px] leading-relaxed text-neutral-400">
          마지막 거래일은 {withDow(probability.lastTradingDay)}입니다.
          {probability.marketClosedToday ? ' 오늘은 주말이라 장이 열리지 않습니다.' : ''} 다음 거래일이
          정확히 언제인지는 휴장일에 따라 달라져 단정하지 않습니다.
        </p>
      ) : null}
    </section>
  );
}

function BreakEven({ cost }: { cost?: CostInfo }) {
  if (!cost) return null;
  const daily = cost.holdings.find((h) => h.days === 1);
  if (!daily) return null;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[1.45rem] font-bold leading-[1.4] tracking-tight text-neutral-900">
        얼마나 맞혀야 이길 수 있나
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-700">
        코스피가 오르내리는 폭 그대로 매일 사고파는 사람은{' '}
        <strong className="font-semibold">{daily.breakEvenStock}%</strong>를 맞혀야 겨우 본전입니다.
        세금과 수수료를 내고 나면 그렇습니다. 그런데 시장이 실제로 주는 건{' '}
        <strong className="font-semibold">{daily.winRate}%</strong>입니다.
      </p>

      <div className="mt-6 space-y-3">
        {cost.holdings.map((h) => {
          const ok = h.edgeStock >= 0;
          return (
            <div key={h.days}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-semibold text-neutral-900">{h.label}마다 매매</span>
                <span className="tabular-nums text-neutral-500">
                  시장 {h.winRate}% / 필요 {h.breakEvenStock}%
                  <span className={`ml-2 font-bold ${ok ? 'text-neutral-900' : 'text-red-700'}`}>
                    {ok ? '+' : ''}
                    {h.edgeStock}%p
                  </span>
                </span>
              </div>
              <div className="relative mt-1.5 h-[10px] bg-neutral-100">
                <div
                  className={`h-full ${ok ? 'bg-neutral-800' : 'bg-neutral-300'}`}
                  style={{ width: `${Math.min(100, h.winRate)}%` }}
                />
                <div
                  className="absolute top-[-3px] h-[16px] w-[2px] bg-red-700"
                  style={{ left: `${Math.min(100, h.breakEvenStock)}%` }}
                  title={`본전선 ${h.breakEvenStock}%`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-neutral-400">
        막대는 시장이 실제로 준 승률, 빨간 선은 본전에 필요한 승률입니다. 막대가 선을 넘지 못하면
        구조적으로 집니다.
      </p>

      <p className="mt-7 text-[16px] leading-relaxed text-neutral-800">
        세계에서 가장 성공한 헤지펀드로 꼽히는 메달리온의 승률은{' '}
        <strong className="font-semibold">{cost.medallionWinRate}%</strong>로 알려져 있습니다. 거의
        동전입니다. 그런데도 이긴 이유는 하루에 수십만 번을 반복했고, 스스로 시장을 만드는 쪽이라
        거래비용이 거의 없었기 때문입니다.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-800">
        같은 승률이어도 개인은 집니다.{' '}
        <strong className="font-semibold">예측력의 차이가 아니라 비용 구조의 차이입니다.</strong>
      </p>

      <div className="mt-8 border border-neutral-300 p-5">
        <div className="text-[13px] font-semibold text-neutral-900">
          다만 이 숫자는 “손익 크기가 시장 평균과 같을 때”의 값입니다
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
          손절과 익절로 이익·손실의 크기를 바꾸면 필요한 승률도 달라집니다. 같은 비용에서도 이렇습니다.
        </p>
        <div className="mt-3 space-y-1.5">
          {cost.payoff.map((c) => (
            <div key={c.label} className="flex items-baseline justify-between text-[12px]">
              <span className="text-neutral-600">
                {c.label}
                <span className="ml-1.5 text-[11px] text-neutral-400">
                  (+{c.gain}% / −{c.loss}%)
                </span>
              </span>
              <span className="tabular-nums font-semibold text-neutral-900">{c.breakEven}%</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
          그래서 “매일 매매하면 무조건 진다”고는 말할 수 없습니다. 정확히는{' '}
          <strong className="font-semibold text-neutral-700">
            시장과 같은 손익 크기로 매일 전액을 굴리면 진다
          </strong>
          는 뜻입니다.
        </p>
      </div>

      <div className="mt-7 bg-neutral-50 p-5">
        <div className="text-[13px] font-semibold text-neutral-900">매매를 자주 할수록 나가는 돈</div>
        <div className="mt-3 space-y-1.5">
          {cost.holdings.map((h) => (
            <div key={h.days} className="flex items-baseline justify-between text-[13px]">
              <span className="text-neutral-500">{h.label}마다</span>
              <span className="tabular-nums text-neutral-900">
                연 <strong className="font-semibold">{h.annualCostStock}%</strong>
                <span className="ml-2 text-[11px] text-neutral-400">ETF는 {h.annualCostEtf}%</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
          매일 사고팔면 1년에 원금의{' '}
          <strong className="font-semibold text-neutral-800">{daily.annualCostStock}%</strong>가 세금과
          수수료로 빠져나갑니다. 남은 돈에 계속 물리는 방식으로 계산하면 원금이{' '}
          <strong className="font-semibold text-neutral-800">{daily.annualDrawdownStock}%</strong>{' '}
          줄어듭니다. 수익을 내기 전에 이미 절반이 사라집니다.
        </p>
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-neutral-400">
        비용 가정 — 개별주식 왕복 {cost.assumptions.stockPct}%(2026년 1월 인상된 증권거래세 0.05% +
        농어촌특별세 0.15% + 위탁수수료 0.03% + 슬리피지 0.05%), 국내 주식형 ETF 왕복{' '}
        {cost.assumptions.etfPct}%(거래세 면제, 호가 스프레드는 종목·시간대에 따라 크게 달라집니다).
        증권사와 종목에 따라 달라집니다.
      </p>
    </section>
  );
}

function Indicators({ indicators, cost }: { indicators?: Indicator[]; cost?: CostInfo }) {
  if (!indicators || indicators.length === 0) return null;
  const best = indicators.reduce((a, b) => (b.topRate > a.topRate ? b : a));
  const breakEven = cost?.holdings.find((h) => h.days === 1)?.breakEvenStock ?? 0;
  const short = Math.round((breakEven - best.topRate) * 10) / 10;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[1.45rem] font-bold leading-[1.4] tracking-tight text-neutral-900">
        볼린저 밴드나 RSI는 어떤가
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-700">
        가장 널리 쓰이는 기술적 지표들을 같은 방식으로 시험했습니다. 지표 값이 높았던 날과 낮았던
        날을 나눠, <strong className="font-semibold">다음 거래일에 실제로 올랐는지</strong>를 세었습니다.
      </p>

      <div className="mt-6 space-y-3.5">
        {indicators.map((d) => (
          <div key={d.key}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold text-neutral-900">{d.label}</span>
              <span className="tabular-nums text-neutral-500">
                낮을 때 {d.rates[0]}% → 높을 때{' '}
                <strong className="font-semibold text-neutral-900">{d.topRate}%</strong>
              </span>
            </div>
            <div className="relative mt-1.5 h-[10px] bg-neutral-100">
              <div className="h-full bg-neutral-800" style={{ width: `${d.topRate}%` }} />
              {breakEven > 0 ? (
                <div
                  className="absolute top-[-3px] h-[16px] w-[2px] bg-red-700"
                  style={{ left: `${breakEven}%` }}
                />
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-neutral-400">{d.note}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-neutral-400">
        막대는 지표가 가장 높았던 5분의 1 구간의 다음날 상승 비율, 빨간 선은 본전에 필요한 승률
        {breakEven > 0 ? ` ${breakEven}%` : ''}입니다.
      </p>

      <div className="mt-7 space-y-3 text-[15px] leading-relaxed text-neutral-800">
        <p>
          <strong className="font-semibold">우연이 아닙니다.</strong> 표본이 8,600일이 넘고, 지표가
          높았던 날의 상승 비율은 통계적으로 뚜렷하게 높습니다. 기술적 지표에 정보가 담겨 있는 것은
          사실입니다.
        </p>
        <p>
          <strong className="font-semibold">그런데 방향이 통념과 반대입니다.</strong> “RSI가 높으면
          과매수라 곧 떨어진다”가 상식이지만, 실제로는 지표가 높았던 날일수록 다음날 더 올랐습니다.
        </p>
        <p>
          그리고 가장 좋았던 {best.label}조차{' '}
          <strong className="font-semibold">{best.topRate}%</strong>입니다. 본전에 필요한{' '}
          <strong className="font-semibold">{breakEven}%</strong>에{' '}
          <strong className="font-semibold">{short}%p 못 미칩니다.</strong>
        </p>
      </div>

      <p className="mt-6 border-l-2 border-neutral-900 pl-4 text-[15px] font-medium leading-relaxed text-neutral-900">
        지표가 틀린 게 아닙니다. 지표에 담긴 정보의 양이 세금과 수수료보다 작을 뿐입니다.
      </p>
    </section>
  );
}

function Dividend({ dividend }: { dividend?: { avg: number; from: string | null } }) {
  if (!dividend || dividend.avg <= 0) return null;
  return (
    <section className="mt-10 bg-neutral-50 p-5">
      <div className="text-[13px] font-semibold text-neutral-900">
        위 숫자들은 배당을 빼고 계산한 것입니다
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
        코스피는 주가만 반영하는 가격지수라 배당이 들어 있지 않습니다.{' '}
        {dividend.from?.slice(0, 4)}년 이후 코스피 지수 배당수익률의 일별 평균은{' '}
        <strong className="font-semibold text-neutral-900">{dividend.avg}%</strong>였습니다. 실제로 받는
        총수익은 배당 시점·재투자 여부·세금에 따라 달라지므로 이 값을 그대로 더할 수는 없지만, 위
        숫자들이 실제 투자 성과를 낮게 잡고 있다는 것만은 분명합니다.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
        기간이 길수록 이 차이가 커집니다. 이 페이지의 장기 수치는 실제 투자 성과를 그만큼 낮게 잡고
        있습니다.
      </p>
    </section>
  );
}

function Quote({ quote }: { quote: { who: string; line: string } }) {
  return (
    <figure className="mt-12 text-center">
      <blockquote className="font-serif text-[18px] italic leading-relaxed text-neutral-800">
        “{quote.line}”
      </blockquote>
      <figcaption className="mt-3 text-[12px] text-neutral-400">{quote.who}</figcaption>
    </figure>
  );
}

function Outcome({
  bucket, trendScore, ci, meta,
}: {
  bucket: Bucket; trendScore: number; ci?: BucketCI; meta?: BootstrapMeta;
}) {
  const lo = Math.min(bucket.min, 0);
  const hi = Math.max(bucket.max, 0);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[15px] font-bold tracking-tight">과거 이 자리에서, 1년 뒤</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500">
        네 잣대는 저마다 답이 달라서 여기서는 하나만 골라야 했습니다.{' '}
        <strong className="font-semibold">주가 위치</strong>를 쓴 이유는 예측을 더 잘해서가 아니라,
        30년으로 가장 길고 외부 계정 없이 누구나 다시 계산할 수 있어서입니다. 실제로 모든 잣대가
        존재하는 공통 기간(2007년 이후)만 놓고 재면 자산 대비(PBR)가 더 나았습니다. 오늘 주가 위치
        점수가 {trendScore.toFixed(0)}점이니,{' '}
        <strong className="font-semibold">과거에 비슷한 점수대였던 날들이 1년 뒤 어떻게 됐는지</strong>를
        모은 것입니다. 다른 잣대를 골랐다면 결과도 달라집니다.
      </p>

      <div className="relative mt-9 h-12">
        <div className="absolute top-5 h-[2px] w-full bg-neutral-200" />
        <div
          className="absolute top-[13px] h-[18px] w-[3px] bg-neutral-900"
          style={{ left: `${pos(bucket.median)}%`, transform: 'translateX(-50%)' }}
        />
        <div className="absolute top-0 text-[12px] font-medium tabular-nums text-neutral-500">
          {bucket.min.toFixed(0)}%
        </div>
        <div className="absolute right-0 top-0 text-[12px] font-medium tabular-nums text-neutral-500">
          +{bucket.max.toFixed(0)}%
        </div>
        <div
          className="absolute top-8 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold tabular-nums text-neutral-900"
          style={{ left: `${pos(bucket.median)}%` }}
        >
          중앙값 {bucket.median >= 0 ? '+' : ''}{bucket.median.toFixed(0)}%
        </div>
      </div>

      <p className="mt-8 text-[16px] leading-relaxed text-neutral-800">
        똑같이 <strong className="font-semibold">{bucket.from}~{bucket.to}도</strong>였던 날이 과거에{' '}
        {bucket.n.toLocaleString('ko-KR')}일 있었습니다. 그 1년 뒤 결과는{' '}
        <strong className="font-semibold">{bucket.min.toFixed(0)}%</strong>부터{' '}
        <strong className="font-semibold">+{bucket.max.toFixed(0)}%</strong>까지 갈렸습니다.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-neutral-500">
        손실로 끝난 경우는 {bucket.negativeRate.toFixed(0)}%였습니다. 높이 올라와 있다는 사실이 곧
        떨어진다는 뜻은 아닙니다.
      </p>
      {ci ? (
        <div className="mt-6 border border-neutral-300 p-4">
          <div className="text-[12px] font-semibold text-neutral-900">
            이 숫자들이 실제로 얼마나 불확실한가
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
            겹치는 구간을 감안해 블록 부트스트랩으로 95% 범위를 구했습니다.
            {meta ? ` ${meta.reps.toLocaleString('ko-KR')}회 반복, ${meta.primaryBlock}일 블록 기준.` : ''}
          </p>
          <div className="mt-3 space-y-2 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-neutral-600">1년 뒤 중앙값</span>
              <span className="tabular-nums text-neutral-900">
                {bucket.median >= 0 ? '+' : ''}
                {bucket.median.toFixed(1)}%
                <span className="ml-2 text-neutral-500">
                  ({ci.medianLow.toFixed(0)}% ~ {ci.medianHigh >= 0 ? '+' : ''}
                  {ci.medianHigh.toFixed(0)}%)
                </span>
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-neutral-600">손실로 끝날 확률</span>
              <span className="tabular-nums text-neutral-900">
                {bucket.negativeRate.toFixed(0)}%
                <span className="ml-2 text-neutral-500">
                  ({ci.negLow.toFixed(0)}% ~ {ci.negHigh.toFixed(0)}%)
                </span>
              </span>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-neutral-600">
            {ci.signCertain
              ? '이 구간은 중앙값의 부호가 확정됩니다. 다섯 구간 중 드문 경우입니다.'
              : '괄호 안이 실제 범위입니다. 중앙값이 플러스인지 마이너스인지조차 확정되지 않습니다.'}
          </p>
          {meta ? (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
              블록 길이를 {meta.blocks.join('·')}일로 바꿔가며 확인했습니다. 다섯 구간 중 부호를
              확정할 수 없는 곳이{' '}
              <strong className="font-medium text-neutral-500">
                {meta.uncertainRange[0]}~{meta.uncertainRange[1]}곳
              </strong>
              으로 블록 선택에 따라 달라집니다. 이 판정은 데이터의 고정된 사실이 아닙니다.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 border-l-2 border-neutral-300 pl-4 text-[12px] leading-relaxed text-neutral-500">
        다만 {bucket.n.toLocaleString('ko-KR')}일이라는 숫자를 표본 크기로 읽으면 안 됩니다. 1년짜리
        창이 서로 364일씩 겹치기 때문에, 서로 다른 시기는{' '}
        <strong className="font-semibold text-neutral-700">대략 {bucket.independentYears}년어치</strong>{' '}
        정도입니다(정확한 유효 표본 수는 아니고 겹침의 크기를 가늠하는 값입니다). 블록 부트스트랩으로
        구간을 잡으면 중앙값의 부호조차 확정되지 않는 구간이 대부분입니다.{' '}
        <strong className="font-semibold text-neutral-700">위 숫자들을 정밀한 값으로 읽지 마세요.</strong>
      </p>
    </section>
  );
}

function Honesty({ data }: { data: ApiResponse }) {
  const s = data.scorecard;
  const worse = s.edgeVsBaseline < 0;

  return (
    <section className="mt-14 border-2 border-neutral-900 px-6 py-7">
      <h2 className="text-[1.45rem] font-bold leading-[1.4] tracking-tight text-neutral-900">
        {worse ? '이 지표는 아무것도 안 하는 것보다 못했습니다' : '이 지표도 자주 틀립니다'}
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
        지난 {s.n}번의 기록을, 그때 알 수 있었던 정보만으로 다시 채점했습니다.
      </p>

      <div className="mt-6 flex items-end gap-8">
        <div>
          <div className="text-[11px] text-neutral-400">이 지표의 적중률</div>
          <div className="mt-1 text-[32px] font-bold leading-none tabular-nums text-neutral-900">
            {s.hitRate}%
          </div>
        </div>
        <div>
          <div className="text-[11px] text-neutral-400">그냥 “오른다”고 찍기</div>
          <div className="mt-1 text-[32px] font-bold leading-none tabular-nums text-neutral-900">
            {s.baselineAlwaysUp}%
          </div>
        </div>
      </div>

      <div className="mt-4 flex h-[10px] w-full bg-neutral-100">
        <div className="h-full bg-neutral-800" style={{ width: `${s.hitRate}%` }} />
      </div>
      <div className="relative h-[14px]">
        <div
          className="absolute top-0 h-[10px] w-[2px] bg-red-700"
          style={{ left: `${s.baselineAlwaysUp}%` }}
        />
      </div>

      <p className="mt-5 text-[16px] leading-relaxed text-neutral-800">
        분석을 하나도 하지 않고 <strong className="font-semibold">언제나 “오른다”</strong>고만 답해도{' '}
        {s.baselineAlwaysUp}%를 맞힙니다. 주식시장에는 오르는 쪽으로 기운 편향이 있기 때문입니다. 이
        지표는 그보다{' '}
        <strong className="font-semibold">{Math.abs(s.edgeVsBaseline)}%p {worse ? '낮았습니다' : '높았습니다'}</strong>.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-neutral-600">
        {worse
          ? '분석이 도움이 된 게 아니라 오히려 방해가 됐다는 뜻입니다. 1년 앞을 두고 50%를 기준으로 삼는 것은 잘못된 비교였고, 우리는 그 잘못된 비교로 이 지표가 동전보다 낫다고 적어두었습니다. 외부 검증에서 지적받아 바로잡았습니다.'
          : '다만 이 차이도 표본이 겹쳐 있어 통계적으로 확정할 수 없습니다.'}
      </p>

      <p className="mt-5 text-[14px] leading-relaxed text-neutral-600">
        예상한 폭도 평균 <strong className="font-semibold">{s.meanAbsError}%p</strong> 빗나갔습니다.
      </p>

      <p className="mt-6 border-t border-neutral-200 pt-5 text-[14px] leading-relaxed text-neutral-700">
        1997년 9월과 1998년 7월은 거의 같은 <strong className="font-semibold">20도</strong>였습니다. 1년 뒤
        하나는 <strong className="font-semibold">−55%</strong>, 다른 하나는{' '}
        <strong className="font-semibold">+186%</strong>였습니다.
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
        그래서 이 숫자는 예보가 아닙니다. 지금이 어디쯤인지 보여주는 눈금일 뿐입니다.
      </p>
    </section>
  );
}

function HowItWasMade() {
  return (
    <section className="mt-12 bg-neutral-50 p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-400">
        만들어진 과정
      </div>
      <h2 className="mt-2 text-[17px] font-bold tracking-tight text-neutral-900">
        이 숫자들은 확인된 결과가 아니라 탐색한 결과입니다
      </h2>

      <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-neutral-700">
        <p>
          온도로 쓸 잣대를 정할 때 다섯 가지를 놓고 비교했습니다. 주가 위치, PER, PBR,
          CAPE, 위험 보상. 그중 <strong className="font-semibold">주가 위치</strong>를 골랐습니다.
        </p>
        <p>
          <strong className="font-semibold">그런데 그 비교가 공정하지 않았습니다.</strong> 잣대마다
          데이터가 시작되는 해가 달라서, 주가 위치만 1996년부터의 외환위기와 닷컴버블을 포함하고
          나머지는 2004~2007년부터였습니다. 서로 다른 시장을 비교한 셈입니다.
        </p>
        <p>
          다섯 잣대가 모두 존재하는 2007년 이후로 기간을 맞춰 다시 재면{' '}
          <strong className="font-semibold">자산 대비(PBR)가 더 나았습니다</strong>(−0.30 대 −0.15).
          그래서 “주가 위치가 미래를 가장 잘 맞혔다”는 설명은 철회했습니다. 지금 이 잣대를 쓰는
          이유는 예측 성적이 아니라 가장 길고, 외부 계정 없이 누구나 다시 계산할 수 있고, 바로
          이해되기 때문입니다.
        </p>
        <p className="border-l-2 border-neutral-400 pl-4 text-neutral-800">
          잣대를 고른 뒤의 모든 통계는 그 선택에 쓴 것과 같은 데이터에서 나왔습니다. 통계학에서는
          이런 결과를 <strong className="font-semibold">탐색적</strong>이라고 부릅니다. 진짜 확인은
          지금부터 새로 쌓이는 기록으로만 가능하며, 첫 채점은 1년 뒤입니다.
        </p>
        <p className="text-neutral-500">
          이 페이지는 그 기록을 매일 남기고 있습니다. 계산 코드와 검증 기록은 모두 공개되어
          있습니다.
        </p>
      </div>
    </section>
  );
}

function Footer({ data }: { data: ApiResponse }) {
  return (
    <footer className="mt-12 text-[11px] leading-relaxed text-neutral-400">
      <p>
        코스피 일별 지수(네이버 금융), 지수 PER·PBR(한국거래소), 국고채 금리·미국 공포지수·원달러 환율
        (FRED)을 {data.coverage.from?.slice(0, 4)}년부터 계산했습니다. 매일 자동으로 기록되며 계산 코드는
        전부 공개되어 있습니다.
      </p>
      <p className="mt-2">
        시장 전체의 상태만 다룹니다. 특정 종목을 추천하지 않으며, 매수·매도 판단의 근거로 쓰기 위한 것이
        아닙니다.
      </p>
    </footer>
  );
}
