'use client';

import { useEffect, useState } from 'react';

type Axis = { key: string; label: string; raw: number; score: number; unit: string };
type Bucket = { from: number; to: number; n: number; min: number; median: number; max: number; negativeRate: number };
type Valuation = { raw: number; score: number; date: string } | null;

type ApiResponse = {
  valuation?: { per: Valuation; pbr: Valuation };
  current: {
    date: string; kospi: number; temp: number; label: string;
    quote: { who: string; line: string }; axes: Axis[];
  } | null;
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

const AXIS_PLAIN: Record<string, string> = {
  price: '5년 평균보다',
  fear: '미국 공포지수(VIX)',
  real: '한국 수출 증가율',
  fx: '원/달러 환율',
  rate: '미국 10년물 금리',
};

function axisValue(a: Axis): string {
  if (a.key === 'price') return `${a.raw >= 0 ? '+' : ''}${a.raw.toFixed(0)}% 위`;
  if (a.key === 'fear') return a.raw.toFixed(1);
  if (a.key === 'real') return `${a.raw >= 0 ? '+' : ''}${a.raw.toFixed(1)}%`;
  if (a.key === 'fx') return `${a.raw.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`;
  return `${a.raw.toFixed(2)}%`;
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
        if (!res.ok || !json || json.error || !json.current) {
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
        ) : data && data.current && data.myBucket ? (
          <>
            <Temp current={data.current} />
            <Axes axes={data.current.axes} />
            <Valuations valuation={data.valuation} today={data.current.date} />
            <Outcome bucket={data.myBucket} />
            <Honesty data={data} />
            <Footer data={data} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function Temp({ current }: { current: NonNullable<ApiResponse['current']> }) {
  const t = current.temp;
  const color = tempColor(t);
  const [y, m, d] = current.date.split('-');

  return (
    <section className="mt-12">
      <div className="text-center">
        <div className="flex items-start justify-center">
          <span className="text-[6rem] font-bold leading-[0.85] tracking-tighter" style={{ color }}>
            {t.toFixed(0)}
          </span>
          <span className="mt-4 text-3xl font-medium text-neutral-300">도</span>
        </div>
        <div className="mt-3 text-2xl font-bold" style={{ color }}>
          {current.label}
        </div>
        <p className="mx-auto mt-3 max-w-[19rem] text-[13px] leading-relaxed text-neutral-500">
          지난 30년과 비교해 코스피가 얼마나 높이 올라와 있는지를 0~100으로 나타낸 값입니다.
        </p>
      </div>

      <div className="relative mt-10">
        <div className="flex h-[4px] w-full">
          <div className="h-full flex-1 bg-emerald-700" />
          <div className="h-full flex-1 bg-sky-700" />
          <div className="h-full flex-1 bg-neutral-300" />
          <div className="h-full flex-1 bg-orange-600" />
          <div className="h-full flex-1 bg-red-700" />
        </div>
        <div
          className="absolute -top-[7px] h-[18px] w-[3px]"
          style={{ left: `${Math.max(0, Math.min(100, t))}%`, background: color, transform: 'translateX(-50%)' }}
        />
        <div className="mt-3 flex justify-between text-[11px] text-neutral-400">
          <span>공포</span>
          <span>중립</span>
          <span>과열</span>
        </div>
      </div>

      <p className="mt-8 text-center text-[13px] text-neutral-500">
        코스피 {current.kospi.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} · {y}년 {Number(m)}월 {Number(d)}일
      </p>

      <figure className="mt-10 text-center">
        <blockquote className="font-serif text-[18px] italic leading-relaxed text-neutral-800">
          “{current.quote.line}”
        </blockquote>
        <figcaption className="mt-3 text-[12px] text-neutral-400">{current.quote.who}</figcaption>
      </figure>
    </section>
  );
}

function Axes({ axes }: { axes: Axis[] }) {
  const price = axes.find((a) => a.key === 'price');
  const context = axes.filter((a) => a.key !== 'price');

  return (
    <>
      <section className="mt-14 border-t border-neutral-200 pt-8">
        <h2 className="text-[15px] font-bold tracking-tight">이 숫자는 무엇을 재는가</h2>
        {price ? (
          <>
            <p className="mt-3 text-[16px] leading-relaxed text-neutral-800">
              코스피가 <strong className="font-semibold">최근 5년 평균보다 {axisValue(price)}</strong>에
              있습니다. 이 거리를 지난 30년과 비교해 백분위로 환산한 것이 온도입니다.
            </p>
            <div className="mt-4 h-[9px] w-full bg-neutral-100">
              <div
                className="h-full"
                style={{ width: `${Math.max(2, Math.min(100, price.score))}%`, background: tempColor(price.score) }}
              />
            </div>
          </>
        ) : null}
        <p className="mt-4 border-l-2 border-neutral-900 pl-4 text-[13px] leading-relaxed text-neutral-600">
          <strong className="font-semibold text-neutral-900">이 숫자는 주가만 봅니다.</strong>{' '}
          기업 이익이 함께 늘었다면 높이 올라온 것이 곧 비싼 것은 아닙니다. 그래서 아래에 이익·자산
          대비로도 따로 확인했습니다.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-[15px] font-bold tracking-tight">오늘의 환경</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
          참고용입니다. 검증 결과 이 넷을 온도에 섞으면 정확도가 오히려 떨어져 빼두었습니다.
        </p>
        <div className="mt-4 space-y-3">
          {context.map((a) => (
            <div key={a.key} className="flex items-center gap-3">
              <div className="w-[128px] shrink-0 text-[12px] leading-tight text-neutral-500">
                {AXIS_PLAIN[a.key] ?? a.label}
              </div>
              <div className="w-[64px] shrink-0 text-right text-[13px] font-medium tabular-nums text-neutral-900">
                {axisValue(a)}
              </div>
              <div className="h-[6px] flex-1 bg-neutral-100">
                <div
                  className="h-full bg-neutral-300"
                  style={{ width: `${Math.max(2, Math.min(100, a.score))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Valuations({
  valuation,
  today,
}: {
  valuation?: { per: Valuation; pbr: Valuation };
  today: string;
}) {
  const per = valuation?.per;
  const pbr = valuation?.pbr;
  if (!per && !pbr) return null;
  // 갱신이 밀리면 낡은 값을 오늘 값처럼 보여주지 않도록 기준일을 밝힌다
  const asOf = pbr?.date ?? per?.date ?? null;
  const stale = asOf !== null && asOf !== today;

  const items = [
    pbr ? { label: '자산 대비 (PBR)', v: `${pbr.raw.toFixed(2)}배`, score: pbr.score } : null,
    per ? { label: '이익 대비 (PER)', v: `${per.raw.toFixed(1)}배`, score: per.score } : null,
  ].filter(Boolean) as { label: string; v: string; score: number }[];

  return (
    <section className="mt-12">
      <h2 className="text-[15px] font-bold tracking-tight">비싼가 — 다른 잣대로</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
        코스피의 자산·이익 대비 가격을 2000년대 초부터의 기록과 비교했습니다.
        {stale && asOf ? ` (${asOf.slice(5).replace('-', '월 ')}일 기준)` : ''}
      </p>
      <div className="mt-4 space-y-4">
        {items.map((it) => (
          <div key={it.label}>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-neutral-600">{it.label}</span>
              <span className="text-[15px] font-semibold tabular-nums text-neutral-900">
                {it.v}
                <span className="ml-2 text-[12px] font-normal" style={{ color: tempColor(it.score) }}>
                  상위 {(100 - it.score).toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-[7px] w-full bg-neutral-100">
              <div className="h-full" style={{ width: `${Math.max(2, Math.min(100, it.score))}%`, background: tempColor(it.score) }} />
            </div>
          </div>
        ))}
      </div>
      {pbr && per ? (
        <p className="mt-4 text-[14px] leading-relaxed text-neutral-700">
          {per.score < pbr.score - 8
            ? '기업 이익이 실제로 크게 늘어 이익 대비로는 덜 극단적입니다. 다만 자산 대비로는 여전히 최상단입니다.'
            : per.score > pbr.score + 8
            ? '자산 대비로는 덜 부담스럽지만, 이익 대비로는 높은 편입니다.'
            : '이익 대비와 자산 대비가 비슷한 수준을 가리킵니다.'}
        </p>
      ) : null}
    </section>
  );
}

function Outcome({ bucket }: { bucket: Bucket }) {
  const lo = Math.min(bucket.min, 0);
  const hi = Math.max(bucket.max, 0);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mt-14 border-t border-neutral-200 pt-8">
      <h2 className="text-[15px] font-bold tracking-tight">과거 이 온도였을 때, 1년 뒤</h2>

      <div className="relative mt-10 h-12">
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
        손실로 끝난 경우는 {bucket.negativeRate.toFixed(0)}%였습니다. 높이 올라와 있다는 사실이
        곧 떨어진다는 뜻은 아닙니다.
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
          <div className="mt-1 text-[34px] font-bold leading-none tabular-nums">{s.meanAbsError}<span className="text-lg">%p</span></div>
          <div className="mt-1 text-[11px] text-neutral-400">빗나감</div>
        </div>
      </div>

      <p className="mt-6 border-t border-neutral-200 pt-5 text-[14px] leading-relaxed text-neutral-700">
        1997년 9월과 1998년 7월은 거의 같은 <strong className="font-semibold">20도</strong>였습니다.
        1년 뒤 하나는 <strong className="font-semibold">−55%</strong>, 다른 하나는{' '}
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
        코스피 일별 지수(네이버 금융)와 미국 공포지수·원달러 환율·미국 10년물 금리·한국 수출(FRED)을
        {data.coverage.from?.slice(0, 4)}년부터 계산했습니다. 매일 자동으로 기록되며, 계산 코드는 전부 공개되어 있습니다.
      </p>
      <p className="mt-2">
        시장 전체의 상태만 다룹니다. 특정 종목을 추천하지 않으며, 매수·매도 판단의 근거로 쓰기 위한 것이 아닙니다.
      </p>
    </footer>
  );
}
