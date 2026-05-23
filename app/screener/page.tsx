'use client';

import { useEffect, useMemo, useState } from 'react';
import rawStocks from '@/data/stocks.sample.json';
import type { StockRaw, StockScored, MarketFilter } from '@/types/stock';
import type { ScreenerResult, ScreenerStock } from '@/lib/screener';
import { scoreStocks } from '@/lib/scoring';
import { addOrUpdateDraft, getFullWatchlist, isInWatchlist } from '@/lib/watchlist-storage';

type ApiResponse = ScreenerResult & {
  cached?: boolean;
  stale?: boolean;
  warning?: string;
  error?: string;
};

export default function ScreenerPage() {
  const [watchlistStocks, setWatchlistStocks] = useState<StockRaw[]>(rawStocks as StockRaw[]);
  const refreshWatchlist = () => setWatchlistStocks(getFullWatchlist());
  useEffect(() => {
    refreshWatchlist();
  }, []);
  const watchlist = useMemo(() => {
    const scored = scoreStocks(watchlistStocks);
    const map = new Map<string, StockScored>();
    scored.forEach((s) => map.set(s.code, s));
    return map;
  }, [watchlistStocks]);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [topN, setTopN] = useState<number>(30);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/screener', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      if (!json) {
        setError('빈 응답');
        return;
      }
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    let rows = data.top;
    if (marketFilter !== 'ALL') rows = rows.filter((s) => s.market === marketFilter);
    return rows.slice(0, topN);
  }, [data, marketFilter, topN]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">저평가 우량 스크리너</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            조엘 그린블라트 <strong>마법공식</strong>으로 코스피·코스닥 시총 상위 종목에서{' '}
            <strong>"PER 낮으면서 ROE 높은"</strong> 종목 자동 발굴.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-sky-500 bg-sky-500/20 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
        >
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </header>

      {data ? (
        <div className="mb-4 space-y-1">
          <div className="text-[11px] text-slate-500">
            기준 시각: {new Date(data.fetchedAt).toLocaleString('ko-KR')}
            {data.cached ? ' · 캐시 (최대 10분)' : ' · 방금 가져옴'}
            {data.stale ? ' · ⚠️ 갱신 실패 — 이전 데이터 표시' : ''}
            {` · 모집단 ${data.universeSize}종목, 적격 ${data.eligible}종목 (적자·우선주·ETF 제외 ${data.excluded}종목)`}
          </div>
          {data.warning ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
              경고: {data.warning}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          데이터 로딩 실패: {error}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
        <span className="text-slate-400">시장</span>
        {(['ALL', 'KOSPI', 'KOSDAQ'] as MarketFilter[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarketFilter(m)}
            className={`rounded-md border px-3 py-1 transition ${
              marketFilter === m
                ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            {m === 'ALL' ? '전체' : m}
          </button>
        ))}
        <span className="ml-3 text-slate-400">표시</span>
        {[10, 30, 50].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setTopN(n)}
            className={`rounded-md border px-3 py-1 transition ${
              topN === n
                ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            Top {n}
          </button>
        ))}
      </div>

      {data ? (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="hidden grid-cols-12 gap-2 border-b border-slate-800 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-500 md:grid">
            <div className="col-span-1">순위</div>
            <div className="col-span-4">종목</div>
            <div className="col-span-1 text-right">오늘</div>
            <div className="col-span-1 text-right">PER</div>
            <div className="col-span-1 text-right">ROE</div>
            <div className="col-span-2 text-right">시총</div>
            <div className="col-span-1 text-right">외국인</div>
            <div className="col-span-1 text-right">합산</div>
          </div>
          <div className="divide-y divide-slate-800/60">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                {loading ? '불러오는 중…' : '조건에 맞는 종목 없음'}
              </div>
            ) : (
              visible.map((stock) => (
                <ScreenerRow
                  key={stock.code}
                  stock={stock}
                  scored={watchlist.get(stock.code) ?? null}
                  onAdded={refreshWatchlist}
                />
              ))
            )}
          </div>
        </section>
      ) : null}

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">⚠️ 사용 시 주의</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>마법공식은 매년 1회 리밸런싱 전략입니다. 단타용이 아닙니다.</li>
          <li>적자 기업(PER ≤ 0)과 ROE ≤ 0 종목은 자동 제외됩니다.</li>
          <li>우선주(이름 끝이 "우")와 ETF/ETN은 자동 제외됩니다.</li>
          <li>높은 순위라고 자동 매수가 아닙니다. 회사 사업 모델·리스크는 본인이 확인하세요.</li>
          <li>한국 시장 2015년 이후 정통 마법공식 효과가 약화. 본인 점수 모델과 교차 확인하면 더 좋습니다.</li>
        </ul>
      </div>

      <footer className="mt-10 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        데이터 출처: 네이버 금융 시가총액 페이지. 개인 판단 보조 도구이며 매수·매도 추천이 아닙니다.
      </footer>
    </main>
  );
}

function ScreenerRow({
  stock,
  scored,
  onAdded,
}: {
  stock: ScreenerStock;
  scored: StockScored | null;
  onAdded: () => void;
}) {
  const up = stock.changePct >= 0;
  const inWatch = scored !== null || isInWatchlist(stock.code);
  const [addState, setAddState] = useState<'idle' | 'fetching' | 'done' | 'error'>(
    inWatch ? 'done' : 'idle',
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    setAddState('fetching');
    setErrMsg(null);
    try {
      const res = await fetch(`/api/stock-data?code=${stock.code}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as
        | { stock?: StockRaw; warnings?: string[]; error?: string }
        | null;
      if (!res.ok || !json || json.error || !json.stock) {
        setErrMsg(json?.error ?? `HTTP ${res.status}`);
        setAddState('error');
        return;
      }
      addOrUpdateDraft(json.stock);
      setAddState('done');
      onAdded();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'unknown');
      setAddState('error');
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-2.5 text-xs hover:bg-slate-900/30 md:grid-cols-12 md:items-center">
      <div className="col-span-2 flex items-center gap-2 md:col-span-1">
        <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
          #{stock.rank}
        </span>
      </div>
      <div className="col-span-2 md:col-span-4">
        <div className="flex flex-wrap items-center gap-2">
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
          ) : addState === 'done' ? (
            <span className="rounded border border-emerald-500/50 bg-emerald-500/10 px-1 text-[10px] text-emerald-300">
              ✓ 추가됨
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={addState === 'fetching'}
              className="rounded border border-sky-500/60 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
            >
              {addState === 'fetching' ? '수집 중…' : '+ 워치리스트'}
            </button>
          )}
          {addState === 'error' && errMsg ? (
            <span className="text-[10px] text-rose-300" title={errMsg}>
              실패
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={`col-span-1 text-right font-medium md:col-span-1 ${up ? 'text-emerald-300' : 'text-rose-300'}`}
      >
        {up ? '+' : ''}
        {stock.changePct.toFixed(2)}%
      </div>
      <div className="col-span-1 text-right text-slate-200 md:col-span-1">
        {stock.per !== null ? stock.per.toFixed(1) : '-'}
      </div>
      <div className="col-span-1 text-right text-slate-200 md:col-span-1">
        {stock.roe !== null ? `${stock.roe.toFixed(1)}%` : '-'}
      </div>
      <div className="col-span-1 text-right text-slate-400 md:col-span-2">{formatCap(stock.marketCap)}</div>
      <div className="col-span-1 text-right text-slate-400 md:col-span-1">
        {stock.foreignRatio.toFixed(1)}%
      </div>
      <div className="col-span-1 text-right text-slate-500 md:col-span-1">
        {stock.magicScore !== null ? stock.magicScore : '-'}
      </div>
    </div>
  );
}

function formatCap(억원: number): string {
  if (억원 >= 10000) return `${(억원 / 10000).toFixed(1)}조`;
  return `${억원.toLocaleString('ko-KR')}억`;
}
