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
            <Gauges gauges={data.gauges} />
            <Tomorrow probability={data.probability} />
            <Quote quote={data.current.quote} />
            <Outcome bucket={data.myBucket} />
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

function Gauges({ gauges }: { gauges: Gauge[] }) {
  return (
    <section className="mt-11">
      <div className="space-y-5">
        {gauges.map((g) => (
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
                style={{ left: `${Math.max(0, Math.min(100, g.score))}%`, background: tempColor(g.score), transform: 'translateX(-50%)' }}
              />
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">{g.question}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-between text-[10px] text-neutral-400">
        <span>0 공포</span>
        <span>50 중립</span>
        <span>과열 100</span>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-neutral-400">
        각 잣대를 2000년대 초부터의 기록과 비교해 0~100으로 환산했습니다. 100에 가까울수록 그 잣대로는
        역사상 가장 뜨거운 축에 든다는 뜻입니다.
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
  const maxP = Math.max(...probability.byHorizon.map((h) => h.pUp));

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

      <div className="mt-6 text-center">
        <div className="text-[4.2rem] font-bold leading-none tracking-tighter text-neutral-900">
          {tomorrow.pUp.toFixed(0)}
          <span className="text-3xl text-neutral-300">%</span>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
          지난 30년간 코스피가 <strong className="font-semibold text-neutral-700">다음 거래일</strong>에 오른 비율입니다.<br />
          {tomorrow.n.toLocaleString('ko-KR')}번을 세었습니다.
        </p>
      </div>

      <p className="mt-7 text-[15px] leading-relaxed text-neutral-800">
        그리고 오늘이 몇 도이든, 이 숫자는{' '}
        <strong className="font-semibold">{min}%에서 {max}% 사이</strong>입니다. 공포권일 때도, 과열권일
        때도 마찬가지입니다.
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
        위에 있는 어떤 잣대도 다음 하루에 대해서는 알려주는 것이 거의 없습니다. 하루 앞을 맞히려는
        시도는 동전던지기에 아주 조금 무게를 얹는 일에 가깝습니다.
      </p>

      <div className="mt-9">
        <div className="text-[13px] font-semibold text-neutral-900">그런데 기간을 늘리면 달라집니다</div>
        <div className="mt-4 space-y-2">
          {probability.byHorizon.map((h) => (
            <div key={h.days} className="flex items-center gap-3">
              <div className="w-[66px] shrink-0 whitespace-nowrap text-[12px] text-neutral-500">{HORIZON_LABEL[h.days]}</div>
              <div className="h-[16px] flex-1 bg-neutral-100">
                <div
                  className="h-full bg-neutral-800"
                  style={{ width: `${(h.pUp / maxP) * 100}%` }}
                />
              </div>
              <div className="w-[44px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-neutral-900">
                {h.pUp.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
          3년·5년 수치는 겹치는 구간을 세었기 때문에 독립 표본이 각각 12회·7회에 불과합니다. 방향은
          분명하지만 정확한 숫자로 받아들이지는 마세요.
        </p>
      </div>

      <p className="mt-7 border-l-2 border-neutral-900 pl-4 text-[15px] font-medium leading-relaxed text-neutral-900">
        확률을 높이는 가장 확실한 방법은 맞히는 것이 아니라 기다리는 것입니다.
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

function Outcome({ bucket }: { bucket: Bucket }) {
  const lo = Math.min(bucket.min, 0);
  const hi = Math.max(bucket.max, 0);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[15px] font-bold tracking-tight">과거 이 자리에서, 1년 뒤</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
        네 잣대 중 과거 성적이 가장 나았던 <strong className="font-semibold text-neutral-500">주가 위치</strong>{' '}
        기준입니다. 다른 잣대로 재면 그림이 달라집니다.
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
