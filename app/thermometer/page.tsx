'use client';

import { useEffect, useState } from 'react';

type Axis = {
  key: string;
  label: string;
  raw: number;
  score: number;
  weight: number;
  unit: string;
  hot: string;
  cold: string;
};

type Bucket = {
  from: number; to: number; label: string; n: number;
  min: number; p25: number; median: number; p75: number; max: number;
  negativeRate: number; mean: number;
};

type ApiResponse = {
  builtAt: string;
  live: boolean;
  coverage: { from: string | null; to: string | null; days: number };
  current: {
    date: string; kospi: number; temp: number; label: string;
    quote: { who: string; line: string }; inverted: boolean; axes: Axis[];
  } | null;
  myBucket: Bucket | null;
  buckets: Bucket[];
  validation: { correlation: number; n: number };
  honest: { correlation: number; n: number };
  scorecard: { n: number; hitRate: number; coinFlipGap: number; meanAbsError: number };
  error?: string;
};

/** 온도 → 잉크 색. 색은 이 지표에서만 쓴다. */
function tempColor(t: number): string {
  if (t >= 80) return '#b91c1c';
  if (t >= 60) return '#c2410c';
  if (t >= 40) return '#57534e';
  if (t >= 20) return '#0369a1';
  return '#047857';
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

export default function ThermometerPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/thermometer', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as ApiResponse | null;
        if (!res.ok || !json || json.error) setError(json?.error ?? `HTTP ${res.status}`);
        else setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <article className="mx-auto max-w-2xl px-6 pb-24 pt-12">
        <header>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-400">
            시민 데이터 지표
          </div>
          <h1 className="mt-3 text-[2.6rem] font-bold leading-none tracking-tight text-neutral-900">
            시장 온도계
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-neutral-600">
            내일을 맞히지 않습니다. <span className="font-semibold text-neutral-900">오늘이 어디인지</span>{' '}
            알려드립니다.
          </p>
        </header>

        {loading ? (
          <p className="mt-16 text-center text-sm text-neutral-400">30년치 시장 데이터를 계산하고 있습니다…</p>
        ) : error ? (
          <p className="mt-16 border-l-2 border-red-600 pl-4 text-sm text-red-700">불러오지 못했습니다 — {error}</p>
        ) : data && data.current ? (
          <>
            <Gauge current={data.current} />
            <Axes axes={data.current.axes} />
            {data.myBucket ? <Distribution bucket={data.myBucket} /> : null}
            <Scorecard data={data} />
            <AllBuckets buckets={data.buckets} currentTemp={data.current.temp} />
            <Limits data={data} />
          </>
        ) : null}

        <footer className="mt-14 border-t border-neutral-200 pt-5 text-[11px] leading-relaxed text-neutral-400">
          데이터 · 네이버 금융(KOSPI 일별), FRED(VIX·원달러·미국 10년물·장단기 금리차·한국 수출)<br />
          계산 코드 전체 공개 · 특정 종목을 다루지 않으며 매수·매도 추천이 아닙니다
        </footer>
      </article>
    </div>
  );
}

function Gauge({ current }: { current: NonNullable<ApiResponse['current']> }) {
  const t = current.temp;
  const color = tempColor(t);

  return (
    <section className="mt-12 border-t-2 border-neutral-900 pt-8">
      <div className="text-center">
        <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">오늘의 온도</div>
        <div className="mt-2 flex items-start justify-center gap-1">
          <span className="text-[5.5rem] font-bold leading-none tracking-tighter" style={{ color }}>
            {t.toFixed(1)}
          </span>
          <span className="mt-3 text-2xl font-medium text-neutral-400">도</span>
        </div>
        <div className="mt-1 text-xl font-semibold" style={{ color }}>
          {current.label}
        </div>
      </div>

      <div className="relative mt-9">
        <div className="flex h-[3px] w-full">
          <div className="h-full flex-1 bg-emerald-700" />
          <div className="h-full flex-1 bg-sky-700" />
          <div className="h-full flex-1 bg-neutral-400" />
          <div className="h-full flex-1 bg-orange-700" />
          <div className="h-full flex-1 bg-red-700" />
        </div>
        <div
          className="absolute -top-2 flex flex-col items-center"
          style={{ left: `${Math.max(0, Math.min(100, t))}%`, transform: 'translateX(-50%)' }}
        >
          <div className="h-[11px] w-[11px] rotate-45 border-2 border-white" style={{ background: color }} />
        </div>
        <div className="mt-2.5 flex justify-between text-[10px] text-neutral-400">
          <span>0 극단적 공포</span>
          <span>50</span>
          <span>극단적 과열 100</span>
        </div>
      </div>

      <p className="mt-7 text-center text-[13px] text-neutral-500">
        KOSPI {current.kospi.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} · {fmtDate(current.date)} 기준
      </p>

      <figure className="mt-9 border-l-2 border-neutral-900 pl-5">
        <blockquote className="font-serif text-[17px] italic leading-relaxed text-neutral-800">
          “{current.quote.line}”
        </blockquote>
        <figcaption className="mt-2 text-[12px] text-neutral-500">— {current.quote.who}</figcaption>
      </figure>

      {current.inverted ? (
        <p className="mt-6 border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
          미국 장단기 금리가 역전된 상태입니다. 과거 경기침체에 1~2년 선행한 경우가 많았습니다.
        </p>
      ) : null}
    </section>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[19px] font-bold tracking-tight text-neutral-900">{children}</h2>
      {sub ? <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">{sub}</p> : null}
    </div>
  );
}

function Axes({ axes }: { axes: Axis[] }) {
  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <SectionTitle sub="다섯 가지를 각각 과거 30년과 비교해 백분위로 환산한 뒤 가중 평균합니다.">
        무엇이 이 온도를 만들었나
      </SectionTitle>
      <div className="divide-y divide-neutral-100">
        {axes.map((a) => (
          <div key={a.key} className="py-3.5">
            <div className="flex items-baseline justify-between">
              <div className="text-[14px] font-semibold text-neutral-900">
                {a.label}
                <span className="ml-2 text-[11px] font-normal text-neutral-400">가중 {a.weight}%</span>
              </div>
              <div className="text-[13px] text-neutral-500">
                {a.raw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
                {a.unit}
                <span className="ml-2 font-semibold" style={{ color: tempColor(a.score) }}>
                  {a.score.toFixed(0)}점
                </span>
              </div>
            </div>
            <div className="mt-2 h-[6px] w-full bg-neutral-100">
              <div
                className="h-full"
                style={{ width: `${Math.max(1.5, Math.min(100, a.score))}%`, background: tempColor(a.score) }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-neutral-400">{a.score >= 50 ? a.hot : a.cold}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Distribution({ bucket }: { bucket: Bucket }) {
  const lo = Math.min(bucket.min, 0);
  const hi = Math.max(bucket.max, 0);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <SectionTitle
        sub={`같은 온도 구간(${bucket.from}~${bucket.to}도)에 있었던 ${bucket.n.toLocaleString('ko-KR')}일의 1년 뒤 KOSPI 수익률입니다.`}
      >
        과거 이 온도에서는 어떻게 됐나
      </SectionTitle>

      <div className="relative mt-8 h-20">
        <div className="absolute top-8 h-px bg-neutral-300" style={{ left: `${pos(bucket.min)}%`, width: `${pos(bucket.max) - pos(bucket.min)}%` }} />
        <div className="absolute top-[22px] h-5 border border-neutral-400 bg-neutral-100" style={{ left: `${pos(bucket.p25)}%`, width: `${Math.max(0.8, pos(bucket.p75) - pos(bucket.p25))}%` }} />
        <div className="absolute top-[18px] h-[29px] w-[2px] bg-neutral-900" style={{ left: `${pos(bucket.median)}%` }} />
        <div className="absolute top-3 w-px border-l border-dashed border-neutral-400" style={{ left: `${pos(0)}%`, height: '2.6rem' }} />
        <div className="absolute top-[3.6rem] -translate-x-1/2 text-[10px] text-neutral-400" style={{ left: `${pos(0)}%` }}>
          0%
        </div>
        <div className="absolute top-0 text-[10px] text-neutral-400" style={{ left: `${pos(bucket.min)}%` }}>
          {bucket.min.toFixed(0)}%
        </div>
        <div className="absolute top-0 -translate-x-full text-[10px] text-neutral-400" style={{ left: `${pos(bucket.max)}%` }}>
          +{bucket.max.toFixed(0)}%
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 border-y border-neutral-200">
        <Cell label="최악" value={bucket.min} />
        <Cell label="하위 25%" value={bucket.p25} />
        <Cell label="중앙값" value={bucket.median} strong />
        <Cell label="상위 25%" value={bucket.p75} />
        <Cell label="최고" value={bucket.max} />
      </div>

      <p className="mt-6 text-[15px] leading-relaxed text-neutral-800">
        같은 온도에서도 1년 뒤 결과는{' '}
        <strong className="font-semibold">{bucket.min.toFixed(0)}%</strong> 부터{' '}
        <strong className="font-semibold">+{bucket.max.toFixed(0)}%</strong> 까지 흩어졌습니다. 손실로
        끝난 경우가 <strong className="font-semibold">{bucket.negativeRate}%</strong>였습니다.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
        이 폭이 곧 “예측할 수 없다”는 뜻입니다. 중앙값 하나만 보지 마세요.
      </p>
    </section>
  );
}

function Cell({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="px-1 py-3 text-center">
      <div className="text-[10px] text-neutral-400">{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? 'text-[17px] font-bold text-neutral-900' : 'text-[14px] font-medium text-neutral-600'}`}>
        {value >= 0 ? '+' : ''}
        {value.toFixed(1)}%
      </div>
    </div>
  );
}

function Scorecard({ data }: { data: ApiResponse }) {
  const s = data.scorecard;
  return (
    <section className="mt-14 border-2 border-neutral-900 p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-500">
        이 지표의 성적표
      </div>
      <h2 className="mt-2 text-[19px] font-bold tracking-tight text-neutral-900">
        위 예상은 실제로 얼마나 맞았나
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
        미래 정보를 쓰지 않고, 각 시점에 알 수 있었던 데이터만으로 다시 계산했습니다.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Metric label="평가 횟수" value={`${s.n}`} unit="회" />
        <Metric label="방향 적중률" value={`${s.hitRate}`} unit="%" emphasize />
        <Metric label="동전던지기 대비" value={`${s.coinFlipGap >= 0 ? '+' : ''}${s.coinFlipGap}`} unit="%p" emphasize />
        <Metric label="평균 오차" value={`${s.meanAbsError}`} unit="%p" />
      </div>

      <div className="mt-6 space-y-2.5 border-t border-neutral-200 pt-5 text-[14px] leading-relaxed text-neutral-700">
        <p>
          오를지 내릴지는 {s.hitRate}% 맞혔습니다. 동전을 던져도 50%입니다. 차이는{' '}
          <strong className="font-semibold text-neutral-900">{s.coinFlipGap}%p</strong>입니다.
        </p>
        <p>
          폭은 평균 <strong className="font-semibold text-neutral-900">{s.meanAbsError}%p</strong> 틀렸습니다.
          “방향을 맞혔다”는 말이 얼마나 공허할 수 있는지 보여주는 숫자입니다.
        </p>
        <p className="text-[13px] text-neutral-500">
          겹치지 않는 표본 {data.honest.n}개 기준 상관계수 {data.honest.correlation} · 통계적으로 유의하지 않습니다(p≈0.21).
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value, unit, emphasize }: { label: string; value: string; unit: string; emphasize?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className="mt-1 tabular-nums">
        <span className={`${emphasize ? 'text-[26px]' : 'text-[22px]'} font-bold leading-none text-neutral-900`}>
          {value}
        </span>
        <span className="ml-0.5 text-[13px] text-neutral-400">{unit}</span>
      </div>
    </div>
  );
}

function AllBuckets({ buckets, currentTemp }: { buckets: Bucket[]; currentTemp: number }) {
  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <SectionTitle sub="뜨거울수록 나빴던 것이 아닙니다. 단조 관계가 성립하지 않습니다.">
        온도 구간별 1년 뒤 결과
      </SectionTitle>
      <div className="-mx-6 overflow-x-auto px-6">
        <table className="w-full min-w-[420px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-y border-neutral-300 text-[10px] uppercase tracking-wider text-neutral-400">
              <th className="py-2.5 text-left font-medium">구간</th>
              <th className="py-2.5 text-right font-medium">표본</th>
              <th className="py-2.5 text-right font-medium">최악</th>
              <th className="py-2.5 text-right font-medium">중앙값</th>
              <th className="py-2.5 text-right font-medium">최고</th>
              <th className="py-2.5 text-right font-medium">손실확률</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const mine = currentTemp >= b.from && currentTemp < b.to;
              return (
                <tr key={b.from} className={`border-b border-neutral-100 ${mine ? 'bg-neutral-50' : ''}`}>
                  <td className="py-2.5 text-left">
                    <span className="font-semibold text-neutral-900">{b.from}–{b.to}</span>
                    <span className="ml-1.5 text-[11px] text-neutral-400">{b.label}</span>
                    {mine ? <span className="ml-1.5 text-[10px] font-semibold text-neutral-900">← 오늘</span> : null}
                  </td>
                  <td className="py-2.5 text-right text-neutral-400">{b.n.toLocaleString('ko-KR')}</td>
                  <td className="py-2.5 text-right text-neutral-600">{b.min.toFixed(1)}%</td>
                  <td className="py-2.5 text-right font-semibold text-neutral-900">
                    {b.median >= 0 ? '+' : ''}{b.median.toFixed(1)}%
                  </td>
                  <td className="py-2.5 text-right text-neutral-600">+{b.max.toFixed(1)}%</td>
                  <td className="py-2.5 text-right text-neutral-600">{b.negativeRate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Limits({ data }: { data: ApiResponse }) {
  const items = [
    '내일, 다음 주, 다음 달을 맞히지 못합니다. 시도하지도 않습니다.',
    `1년 뒤 수익률과의 관계는 겹치지 않는 표본 ${data.honest.n}개 기준 상관 ${data.honest.correlation}로, 우연과 구분되지 않는 수준입니다.`,
    '1997년 9월과 1998년 7월은 거의 같은 온도(20도)였지만 1년 뒤 −55.5%와 +186.0%로 갈렸습니다.',
    `표본은 ${data.coverage.days.toLocaleString('ko-KR')}일이지만 1년 창이 겹치므로 독립 표본은 약 30개입니다.`,
    '개별 종목에는 적용할 수 없습니다. 시장 전체 상태만 다룹니다.',
  ];
  return (
    <section className="mt-14 bg-neutral-50 p-6">
      <h2 className="text-[15px] font-bold tracking-tight text-neutral-900">이 지표가 할 수 없는 일</h2>
      <ul className="mt-4 space-y-2.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-neutral-600">
            <span className="mt-[2px] text-neutral-300">—</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-neutral-200 pt-3 text-[11px] text-neutral-400">
        데이터 {data.coverage.from} ~ {data.coverage.to} · 갱신 {data.builtAt}
        {data.live ? ' · 오늘 값 실시간 반영' : ''}
      </p>
    </section>
  );
}
