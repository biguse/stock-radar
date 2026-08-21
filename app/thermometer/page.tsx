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

type Bucket = { from: number; to: number; n: number; min: number; median: number; max: number; negativeRate: number };

type Probability = {
  lastTradingDay: string | null;
  todayKst: string;
  marketClosedToday: boolean;
  byHorizon: { days: number; pUp: number; n: number; independent: number }[];
  tomorrowByTemp: { from: number; to: number; pUp: number; n: number }[];
  tomorrowSpread: { min: number; max: number };
};

type ApiResponse = {
  probability?: Probability;
  current: { date: string; kospi: number; temp: number; label: string; quote: { who: string; line: string } } | null;
  gauges: Gauge[];
  range: { min: number; max: number; median: number; spread: number } | null;
  myBucket: Bucket | null;
  coverage: { from: string | null; to: string | null };
  honest: { correlation: number; n: number };
  scorecard: { n: number; hitRate: number; coinFlipGap: number; meanAbsError: number };
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
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-relaxed text-neutral-500">
            내일을 맞히지 않습니다.<br />
            <span className="font-semibold text-neutral-900">오늘이 어디인지</span> 알려드립니다.
          </p>
        </header>

        {state === 'loading' ? (
          <p className="mt-20 text-center text-sm text-neutral-400">계산하는 중…</p>
        ) : state === 'error' ? (
          <p className="mt-20 text-center text-sm text-red-700">불러오지 못했습니다 — {err}</p>
        ) : data && data.current && data.range && data.myBucket ? (
          <>
            <Headline range={data.range} current={data.current} />
            <Gauges gauges={data.gauges} kospi={data.current.kospi} />
            <Tomorrow probability={data.probability} />
            <Quote quote={data.current.quote} />
            <Outcome bucket={data.myBucket} trendScore={data.gauges.find((g) => g.key === 'trend')?.score ?? 0} />
            <Honesty data={data} />
            <Footer data={data} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function Headline({
  range,
  current,
}: {
  range: NonNullable<ApiResponse['range']>;
  current: NonNullable<ApiResponse['current']>;
}) {
  const [y, m, d] = current.date.split('-');
  return (
    <section className="mt-12 text-center">
      <div className="flex items-start justify-center gap-3">
        <span className="text-[4.6rem] font-bold leading-[0.85] tracking-tighter" style={{ color: tempColor(range.min) }}>
          {range.min.toFixed(0)}
        </span>
        <span className="mt-6 text-3xl font-light text-neutral-300">–</span>
        <span className="text-[4.6rem] font-bold leading-[0.85] tracking-tighter" style={{ color: tempColor(range.max) }}>
          {range.max.toFixed(0)}
        </span>
        <span className="mt-6 text-2xl font-medium text-neutral-300">도</span>
      </div>

      <p className="mx-auto mt-6 max-w-[20rem] text-[15px] font-medium leading-relaxed text-neutral-900">
        {verdict(range)}
      </p>
      <p className="mt-2 text-[13px] text-neutral-500">
        같은 시장인데, 무엇으로 재느냐에 따라 이만큼 다릅니다.
      </p>
      <p className="mt-5 text-[13px] text-neutral-400">
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
        why: '시장이 평소 다니던 궤도에서 얼마나 멀리 왔는지를 봅니다.',
        limit: '주가만 봅니다. 기업 이익이 함께 늘었다면 높이 올라온 것이 곧 비싼 것은 아닙니다.',
      };
    case 'pbr':
      return {
        means: `상장기업들이 가진 순자산의 약 ${g.raw.toFixed(1)}배 가격에 거래되고 있다는 뜻입니다. 1배면 장부에 적힌 값과 같은 가격입니다.`,
        score: `${g.score.toFixed(0)}점은, 2002년 이후 이보다 비쌌던 적이 거의 없다는 뜻입니다. 한국 증시는 오랫동안 1배 안팎에 머물렀습니다.`,
        why: '이익은 해마다 출렁이지만 자산은 천천히 변합니다. 그래서 가격이 과했는지 보는 데는 비교적 안정적인 잣대입니다.',
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
        score: `${g.score.toFixed(0)}점은, 그 대가가 역사적으로 얇은 편이라는 뜻입니다. 예금·채권과 비교한 주식의 매력이 낮아진 상태입니다.`,
        why: '하워드 마크스 같은 투자자들이 “지금 위험이 제대로 보상받고 있는가”를 볼 때 쓰는 방식입니다. 가격의 높낮이가 아니라 대가를 봅니다.',
        limit: '금리가 급변하면 크게 흔들립니다. 또 앞으로 벌 이익이 아니라 이미 번 이익으로 계산합니다.',
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
        놓았습니다. 점수는 “지금 값이 과거 기록 중 몇 번째로 뜨거운가”입니다. 90점이면 과거 90%의 날보다
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
  if (!tomorrow) return null;
  const { min, max } = probability.tomorrowSpread;
  const up = tomorrow.pUp;
  const down = Math.round((100 - up) * 10) / 10;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[15px] font-bold tracking-tight">다음 거래일에 오를까요</h2>
      {probability.lastTradingDay ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
          마지막 거래일은 {withDow(probability.lastTradingDay)}입니다.
          {probability.marketClosedToday ? ' 오늘은 주말이라 장이 열리지 않습니다.' : ''}{' '}
          다음 거래일이 정확히 언제인지는 휴장일에 따라 달라져 단정하지 않습니다.
        </p>
      ) : null}

      {/* 52%를 '오를 가능성이 높다'로 읽지 않도록, 오름과 내림을 반드시 함께 보여준다 */}
      <div className="mt-7">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] text-neutral-400">오른다</div>
            <div className="text-[2.6rem] font-bold leading-none tabular-nums text-neutral-900">
              {up.toFixed(0)}<span className="text-lg text-neutral-400">%</span>
            </div>
          </div>
          <div className="pb-1 text-[13px] font-medium text-neutral-400">거의 반반</div>
          <div className="text-right">
            <div className="text-[11px] text-neutral-400">내린다</div>
            <div className="text-[2.6rem] font-bold leading-none tabular-nums text-neutral-900">
              {down.toFixed(0)}<span className="text-lg text-neutral-400">%</span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex h-[14px] w-full overflow-hidden">
          <div className="h-full bg-neutral-800" style={{ width: `${up}%` }} />
          <div className="h-full bg-neutral-300" style={{ width: `${down}%` }} />
        </div>
      </div>

      <p className="mt-6 text-[16px] leading-relaxed text-neutral-800">
        지난 30년, 코스피는 100번 중 <strong className="font-semibold">{up.toFixed(0)}번 올랐고{' '}
        {down.toFixed(0)}번 내렸습니다.</strong> 오른 날이 {(up - down).toFixed(0)}번 더 많았을 뿐입니다.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-neutral-500">
        {up.toFixed(0)}%를 “오를 가능성이 높다”로 읽으면 안 됩니다. 동전을 던지는 것과 거의 같다는
        뜻입니다.
      </p>

      <p className="mt-6 text-[15px] leading-relaxed text-neutral-800">
        그리고 오늘이 몇 도이든 이 숫자는{' '}
        <strong className="font-semibold">{min}%에서 {max}% 사이</strong>입니다. 공포권일 때도 과열권일
        때도 반반에서 크게 벗어나지 않습니다. 위에 있는 어떤 잣대도 하루 앞에 대해서는 알려주는 것이
        거의 없습니다.
      </p>

      <div className="mt-9">
        <div className="text-[13px] font-semibold text-neutral-900">그런데 기간을 늘리면 달라집니다</div>
        <div className="mt-4 space-y-2">
          {probability.byHorizon.map((h) => {
            const d = Math.round((100 - h.pUp) * 10) / 10;
            return (
              <div key={h.days} className="flex items-center gap-3">
                <div className="w-[66px] shrink-0 whitespace-nowrap text-[12px] text-neutral-500">
                  {HORIZON_LABEL[h.days]}
                </div>
                <div className="flex h-[16px] flex-1 overflow-hidden">
                  <div className="h-full bg-neutral-800" style={{ width: `${h.pUp}%` }} />
                  <div className="h-full bg-neutral-200" style={{ width: `${d}%` }} />
                </div>
                <div className="w-[62px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-neutral-900">
                  {h.pUp.toFixed(0)}:{d.toFixed(0)}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-neutral-400">진한 쪽이 오른 비율, 옅은 쪽이 내린 비율입니다.</p>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
          3년·5년 수치는 겹치는 구간을 세었기 때문에 독립 표본이 각각 12회·7회에 불과합니다. 방향은
          분명하지만 정확한 숫자로 받아들이지는 마세요.
        </p>
      </div>

      <p className="mt-7 border-l-2 border-neutral-900 pl-4 text-[15px] font-medium leading-relaxed text-neutral-900">
        이 기록이 말하는 것은 하나입니다. 짧게 볼수록 동전에 가깝고, 길게 볼수록 오른 쪽이 많았습니다.
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

function Outcome({ bucket, trendScore }: { bucket: Bucket; trendScore: number }) {
  const lo = Math.min(bucket.min, 0);
  const hi = Math.max(bucket.max, 0);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[15px] font-bold tracking-tight">과거 이 자리에서, 1년 뒤</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500">
        네 잣대는 서로 다른 답을 주기 때문에 여기서는 하나만 골라야 했습니다. 그중 과거에 미래를 그나마
        가장 잘 맞혔던 <strong className="font-semibold">주가 위치</strong>를 썼습니다. 오늘 그 점수가{' '}
        {trendScore.toFixed(0)}점이니,{' '}
        <strong className="font-semibold">과거에 비슷한 점수대였던 날들이 1년 뒤 어떻게 됐는지</strong>를 모은
        것입니다. 다른 잣대로 고르면 그림이 달라집니다.
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
    </section>
  );
}

function Honesty({ data }: { data: ApiResponse }) {
  const s = data.scorecard;
  return (
    <section className="mt-14 border-2 border-neutral-900 px-6 py-7">
      <h2 className="text-[15px] font-bold tracking-tight">이 지표도 자주 틀립니다</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
        지난 {s.n}번의 기록을, 그때 알 수 있었던 정보만으로 다시 채점했습니다.
      </p>

      <div className="mt-6 flex items-end gap-8">
        <div>
          <div className="text-[11px] text-neutral-400">오를지 내릴지</div>
          <div className="mt-1 text-[34px] font-bold leading-none tabular-nums">{s.hitRate}%</div>
          <div className="mt-1 text-[11px] text-neutral-400">동전던지기는 50%</div>
        </div>
        <div>
          <div className="text-[11px] text-neutral-400">폭은 평균</div>
          <div className="mt-1 text-[34px] font-bold leading-none tabular-nums">
            {s.meanAbsError}
            <span className="text-lg">%p</span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">빗나감</div>
        </div>
      </div>

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
