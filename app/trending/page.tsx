'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import rawStocks from '@/data/stocks.sample.json';
import type { StockRaw, StockScored } from '@/types/stock';
import type { TrendingResult, TrendingStock } from '@/lib/trending';
import { scoreStocks } from '@/lib/scoring';

type ApiResponse = TrendingResult & { cached?: boolean; error?: string };

export default function TrendingPage() {
  const watchlist = useMemo(() => {
    const scored = scoreStocks(rawStocks as StockRaw[]);
    const map = new Map<string, StockScored>();
    scored.forEach((s) => map.set(s.code, s));
    return map;
  }, []);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trending', { cache: 'no-store' });
      const json = (await res.json()) as ApiResponse;
      if (json.error) {
        setError(json.error);
      } else {
        setData(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">오늘 뜨는 종목</h1>
          <p className="mt-2 text-sm text-slate-400">
            네이버 금융 실시간 거래량 / 급등 / 급락 리스트 + 본인 워치리스트 점수 매칭. 빨간{' '}
            <span className="rounded border border-rose-500/50 bg-rose-500/10 px-1 text-[10px] text-rose-300">
              워치
            </span>{' '}
            배지는 본인 워치리스트에 있는 종목입니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            ← 워치리스트
          </Link>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-sky-500 bg-sky-500/20 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </header>

      {data ? (
        <div className="mb-4 text-[11px] text-slate-500">
          기준 시각: {new Date(data.fetchedAt).toLocaleString('ko-KR')}
          {data.cached ? ' · 캐시 (최대 5분)' : ' · 방금 가져옴'}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          네이버에서 데이터를 못 가져왔습니다: {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <RecommendationBanner data={data} watchlist={watchlist} />
          <Panel
            title="거래량 / 거래대금 상위"
            tone="sky"
            description="실시간으로 돈이 가장 많이 몰리는 종목들"
            stocks={data.volume}
            watchlist={watchlist}
            showTradingValue
          />
          <Panel
            title="급등 종목"
            tone="emerald"
            description="오늘 등락률이 가장 높은 종목들"
            stocks={data.gainers}
            watchlist={watchlist}
          />
          <Panel
            title="급락 종목"
            tone="rose"
            description="오늘 등락률이 가장 낮은 종목들 — 저점 매수 후보 또는 회피 대상"
            stocks={data.losers}
            watchlist={watchlist}
          />
        </div>
      ) : loading ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          네이버 금융에서 데이터 가져오는 중…
        </div>
      ) : null}

      <footer className="mt-10 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        데이터 출처: 네이버 금융. 본인 개인용 도구이며 매수·매도 추천이 아닙니다. 결정 책임은 본인에게 있습니다.
      </footer>
    </main>
  );
}

function RecommendationBanner({
  data,
  watchlist,
}: {
  data: TrendingResult;
  watchlist: Map<string, StockScored>;
}) {
  const dipCandidates = data.losers
    .filter((s) => {
      const w = watchlist.get(s.code);
      return w && (w.grade === 'S' || w.grade === 'A' || w.grade === 'B') && s.changePct <= -2;
    })
    .slice(0, 3);

  const momentumCandidates = data.gainers
    .filter((s) => {
      const w = watchlist.get(s.code);
      return w && (w.grade === 'S' || w.grade === 'A' || w.grade === 'B') && s.changePct >= 3;
    })
    .slice(0, 3);

  if (dipCandidates.length === 0 && momentumCandidates.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
        오늘 본인 워치리스트(B 등급 이상)와 겹치는 급등·급락 종목이 없습니다. 워치리스트를 늘리면 신호가 자주 잡힙니다.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Recommendation
        title="분할매수 후보"
        tone="emerald"
        hint="워치리스트 B+ 등급 중 오늘 -2% 이상 빠진 종목"
        items={dipCandidates}
        watchlist={watchlist}
      />
      <Recommendation
        title="모멘텀 후보"
        tone="amber"
        hint="워치리스트 B+ 등급 중 오늘 +3% 이상 오른 종목"
        items={momentumCandidates}
        watchlist={watchlist}
      />
    </div>
  );
}

function Recommendation({
  title,
  tone,
  hint,
  items,
  watchlist,
}: {
  title: string;
  tone: 'emerald' | 'amber';
  hint: string;
  items: TrendingStock[];
  watchlist: Map<string, StockScored>;
}) {
  const border = tone === 'emerald' ? 'border-emerald-500/40' : 'border-amber-500/40';
  const titleColor = tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300';

  return (
    <div className={`rounded-lg border ${border} bg-slate-900/50 p-4`}>
      <div className={`text-sm font-semibold ${titleColor}`}>{title}</div>
      <div className="mt-1 text-[11px] text-slate-400">{hint}</div>
      {items.length === 0 ? (
        <div className="mt-3 text-xs text-slate-500">해당 조건의 종목 없음</div>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((s) => {
            const w = watchlist.get(s.code)!;
            return (
              <li
                key={s.code}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-100">{s.name}</span>
                  <span className="ml-2 text-slate-500">{s.code}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-medium ${s.changePct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                  >
                    {s.changePct >= 0 ? '+' : ''}
                    {s.changePct.toFixed(2)}%
                  </span>
                  <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                    {w.grade} · {w.totalScore}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Panel({
  title,
  tone,
  description,
  stocks,
  watchlist,
  showTradingValue,
}: {
  title: string;
  tone: 'sky' | 'emerald' | 'rose';
  description: string;
  stocks: TrendingStock[];
  watchlist: Map<string, StockScored>;
  showTradingValue?: boolean;
}) {
  const border =
    tone === 'sky' ? 'border-sky-500/40' : tone === 'emerald' ? 'border-emerald-500/40' : 'border-rose-500/40';
  const titleColor =
    tone === 'sky' ? 'text-sky-200' : tone === 'emerald' ? 'text-emerald-200' : 'text-rose-200';

  return (
    <section className={`rounded-lg border ${border} bg-slate-900/40`}>
      <div className="border-b border-slate-800 px-4 py-3">
        <div className={`text-sm font-semibold ${titleColor}`}>{title}</div>
        <div className="text-[11px] text-slate-400">{description}</div>
      </div>
      <div className="divide-y divide-slate-800/60">
        {stocks.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">데이터 없음</div>
        ) : (
          stocks.map((s) => (
            <Row key={`${s.code}-${s.rank}`} stock={s} scored={watchlist.get(s.code) ?? null} showTradingValue={showTradingValue} />
          ))
        )}
      </div>
    </section>
  );
}

function Row({
  stock,
  scored,
  showTradingValue,
}: {
  stock: TrendingStock;
  scored: StockScored | null;
  showTradingValue?: boolean;
}) {
  const up = stock.changePct >= 0;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-slate-900/30">
      <div className="flex items-center gap-3">
        <span className="w-6 text-right text-slate-500">{stock.rank}</span>
        <div>
          <div className="flex items-center gap-2">
            <a
              href={`https://finance.naver.com/item/main.naver?code=${stock.code}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-100 hover:text-sky-300 hover:underline"
            >
              {stock.name}
            </a>
            <span className="text-[10px] text-slate-500">{stock.code}</span>
            <span className="text-[10px] text-slate-600">{stock.market}</span>
            {scored ? (
              <span className="rounded border border-rose-500/50 bg-rose-500/10 px-1 text-[10px] text-rose-300">
                워치 · {scored.grade} · {scored.totalScore}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-right">
        <span className="w-20 text-slate-300">{stock.price.toLocaleString('ko-KR')}원</span>
        <span className={`w-16 font-medium ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
          {up ? '+' : ''}
          {stock.changePct.toFixed(2)}%
        </span>
        <span className="w-24 text-slate-500">{formatVolume(stock.volume)}주</span>
        {showTradingValue ? (
          <span className="hidden w-24 text-slate-500 md:inline">
            {stock.tradingValue ? formatValue(stock.tradingValue) : '-'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 10_000).toFixed(1)}만`;
  return v.toLocaleString('ko-KR');
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}조`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(0)}억`;
  if (v > 0) return `${v.toLocaleString('ko-KR')}백만`;
  return '-';
}
