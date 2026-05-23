'use client';

import { useEffect, useMemo, useState } from 'react';
import rawStocks from '@/data/stocks.sample.json';
import type { StockRaw, StockScored } from '@/types/stock';
import type { InvestorFlow, TrendingResult, TrendingStock } from '@/lib/trending';
import type { StockTiming } from '@/lib/market';
import { scoreStocks } from '@/lib/scoring';
import { useMarketPulse } from '@/components/market-pulse';
import { addOrUpdateDraft, getFullWatchlist, isInWatchlist } from '@/lib/watchlist-storage';

type ApiResponse = TrendingResult & {
  cached?: boolean;
  stale?: boolean;
  warning?: string;
  error?: string;
};

export default function TrendingPage() {
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
  const { data: pulse } = useMarketPulse();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trending', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok) {
        const message = json?.error ?? `HTTP ${res.status}`;
        setError(message);
        return;
      }
      if (!json) {
        setError('빈 응답 (JSON 파싱 실패)');
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">오늘 뜨는 종목</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            네이버 금융 실시간 데이터 + 본인 워치리스트 점수. 빨간{' '}
            <span className="rounded border border-rose-500/50 bg-rose-500/10 px-1 text-[10px] text-rose-300">
              워치
            </span>{' '}
            배지는 본인 워치리스트에 있는 종목입니다.
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
            {data.cached ? ' · 캐시 (최대 5분)' : ' · 방금 가져옴'}
            {data.stale ? ' · ⚠️ 갱신 실패 — 이전 데이터 표시' : ''}
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
          네이버에서 데이터를 못 가져왔습니다: {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <RecommendationSection
            data={data}
            watchlist={watchlist}
            marketTiming={pulse?.watchlistTiming ?? {}}
          />
          <PumpRiskPanel stocks={data.pumpRisk} />
          <Panel
            title="거래량 / 거래대금 상위"
            tone="sky"
            description="오늘 가장 돈이 몰린 종목들 (단, ETF·인버스 다수 포함)"
            stocks={data.volume}
            watchlist={watchlist}
            showTradingValue
            onAdded={refreshWatchlist}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <InvestorPanel
              title="외국인 순매수 상위"
              tone="emerald"
              description="외국인이 오늘 가장 많이 산 종목"
              flows={data.foreignBuy}
              watchlist={watchlist}
              onAdded={refreshWatchlist}
            />
            <InvestorPanel
              title="외국인 순매도 상위"
              tone="rose"
              description="외국인이 오늘 가장 많이 판 종목"
              flows={data.foreignSell}
              watchlist={watchlist}
              onAdded={refreshWatchlist}
            />
            <InvestorPanel
              title="기관 순매수 상위"
              tone="emerald"
              description="기관(연기금·투신·보험 등)이 오늘 가장 많이 산 종목"
              flows={data.institutionBuy}
              watchlist={watchlist}
              onAdded={refreshWatchlist}
            />
            <InvestorPanel
              title="기관 순매도 상위"
              tone="rose"
              description="기관이 오늘 가장 많이 판 종목"
              flows={data.institutionSell}
              watchlist={watchlist}
              onAdded={refreshWatchlist}
            />
          </div>
          <Panel
            title="급등 종목"
            tone="emerald"
            description="오늘 등락률 상위"
            stocks={data.gainers}
            watchlist={watchlist}
            onAdded={refreshWatchlist}
          />
          <Panel
            title="급락 종목"
            tone="rose"
            description="오늘 등락률 하위 — 저점 매수 후보 또는 회피 대상"
            stocks={data.losers}
            watchlist={watchlist}
            onAdded={refreshWatchlist}
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

type SignalSource = 'volume' | 'gainers' | 'losers';
type MatchedSignal = { stock: TrendingStock; sources: Set<SignalSource> };

function isFollowable(grade: StockScored['grade']): boolean {
  return grade === 'S' || grade === 'A' || grade === 'B';
}

function RecommendationSection({
  data,
  watchlist,
  marketTiming,
}: {
  data: TrendingResult;
  watchlist: Map<string, StockScored>;
  marketTiming: Record<string, StockTiming>;
}) {
  const matched = new Map<string, MatchedSignal>();

  function addSignal(stocks: TrendingStock[], source: SignalSource) {
    for (const s of stocks) {
      const w = watchlist.get(s.code);
      if (!w || !isFollowable(w.grade)) continue;
      const existing = matched.get(s.code);
      if (existing) {
        existing.sources.add(source);
      } else {
        matched.set(s.code, { stock: s, sources: new Set([source]) });
      }
    }
  }

  addSignal(data.volume, 'volume');
  addSignal(data.gainers, 'gainers');
  addSignal(data.losers, 'losers');

  const all = Array.from(matched.values());

  const dipCandidates = all
    .filter((m) => m.sources.has('volume') && m.stock.changePct <= -2)
    .sort((a, b) => {
      const ta = a.stock.tradingValue ?? 0;
      const tb = b.stock.tradingValue ?? 0;
      if (tb !== ta) return tb - ta;
      return a.stock.changePct - b.stock.changePct;
    })
    .slice(0, 3);

  const momentumCandidates = all
    .filter((m) => m.sources.has('volume') && m.stock.changePct >= 3)
    .sort((a, b) => {
      const ta = a.stock.tradingValue ?? 0;
      const tb = b.stock.tradingValue ?? 0;
      if (tb !== ta) return tb - ta;
      return b.stock.changePct - a.stock.changePct;
    })
    .slice(0, 3);

  const foreignWatch = data.foreignBuy
    .filter((f) => {
      const w = watchlist.get(f.code);
      return w !== undefined && isFollowable(w.grade);
    })
    .slice(0, 3);

  const institutionWatch = data.institutionBuy
    .filter((f) => {
      const w = watchlist.get(f.code);
      return w !== undefined && isFollowable(w.grade);
    })
    .slice(0, 3);

  type PullbackCandidate = { stockCode: string; name: string; grade: StockScored['grade']; totalScore: number; dropFromHighPct: number };
  const pullbackCandidates: PullbackCandidate[] = [];
  watchlist.forEach((w, code) => {
    if (!isFollowable(w.grade)) return;
    const t = marketTiming[code];
    if (!t) return;
    if (t.dropFromHighPct > -15) return;
    pullbackCandidates.push({
      stockCode: code,
      name: w.name,
      grade: w.grade,
      totalScore: w.totalScore,
      dropFromHighPct: t.dropFromHighPct,
    });
  });
  pullbackCandidates.sort((a, b) => a.dropFromHighPct - b.dropFromHighPct);

  const noSignal =
    dipCandidates.length === 0 &&
    momentumCandidates.length === 0 &&
    foreignWatch.length === 0 &&
    institutionWatch.length === 0 &&
    pullbackCandidates.length === 0;

  if (noSignal) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
        오늘 본인 워치리스트와 겹치는 강한 신호가 없습니다. 워치리스트를 늘리면 신호 빈도가 높아집니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pullbackCandidates.length > 0 ? (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="text-sm font-semibold text-sky-200">낙폭 후보</div>
          <div className="mt-1 text-[11px] text-sky-300/80">
            워치리스트 B+ 등급 중 52주 신고가 대비 -15% 이상 빠진 종목. 단기 등락(오늘)과 별개로 "충분히
            조정 받은 우량주" 진입 후보. 더 빠질 수도 있는 점 유의.
          </div>
          <ul className="mt-3 space-y-2">
            {pullbackCandidates.slice(0, 5).map((c) => (
              <li
                key={c.stockCode}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{c.name}</span>
                  <span className="text-slate-500">{c.stockCode}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sky-300">
                    신고가 {c.dropFromHighPct.toFixed(1)}%
                  </span>
                  <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                    {c.grade} · {c.totalScore}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <PriceSignal
          title="분할매수 후보"
          tone="emerald"
          hint="워치리스트 B+ 등급 + 거래량 동반 + 오늘 -2% 이상 (거래대금 큰 순)"
          items={dipCandidates}
          watchlist={watchlist}
        />
        <PriceSignal
          title="모멘텀 후보"
          tone="amber"
          hint="워치리스트 B+ 등급 + 거래량 동반 + 오늘 +3% 이상 (거래대금 큰 순)"
          items={momentumCandidates}
          watchlist={watchlist}
        />
        <InvestorSignal
          title="외국인이 사는 내 종목"
          tone="sky"
          hint="외국인 순매수 상위 중 워치리스트 종목"
          items={foreignWatch}
          watchlist={watchlist}
        />
        <InvestorSignal
          title="기관이 사는 내 종목"
          tone="indigo"
          hint="기관 순매수 상위 중 워치리스트 종목"
          items={institutionWatch}
          watchlist={watchlist}
        />
      </div>
    </div>
  );
}

function PriceSignal({
  title,
  tone,
  hint,
  items,
  watchlist,
}: {
  title: string;
  tone: 'emerald' | 'amber';
  hint: string;
  items: MatchedSignal[];
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
          {items.map((m) => {
            const w = watchlist.get(m.stock.code)!;
            const s = m.stock;
            return (
              <li
                key={s.code}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{s.name}</span>
                  <span className="text-slate-500">{s.code}</span>
                  <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1 text-[10px] text-amber-300">
                    거래량↑
                  </span>
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

function InvestorSignal({
  title,
  tone,
  hint,
  items,
  watchlist,
}: {
  title: string;
  tone: 'sky' | 'indigo';
  hint: string;
  items: InvestorFlow[];
  watchlist: Map<string, StockScored>;
}) {
  const border = tone === 'sky' ? 'border-sky-500/40' : 'border-indigo-500/40';
  const titleColor = tone === 'sky' ? 'text-sky-300' : 'text-indigo-300';

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
                  <span className="text-slate-300">{formatAmount(s.amount)}</span>
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

function PumpRiskPanel({ stocks }: { stocks: TrendingStock[] }) {
  if (stocks.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-500">
        ⚠️ 작전주 의심 종목: 현재 없음 (시총 1,000억 미만 + 등락 +15% 이상 종목 없음)
      </div>
    );
  }
  return (
    <section className="rounded-lg border-2 border-rose-500/60 bg-rose-950/30 p-4">
      <div className="text-sm font-semibold text-rose-200">
        ⚠️ 작전주 의심 — 충동매수 금지
      </div>
      <div className="mt-1 text-[11px] text-rose-300/80">
        시총 1,000억원 미만 + 오늘 +15% 이상 급등. 정상적인 호재일 수도, 작전 세력일 수도 있습니다.
        뉴스·공시 확인 없이 들어가지 마세요.
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {stocks.map((s) => (
          <a
            key={s.code}
            href={`https://finance.naver.com/item/main.naver?code=${s.code}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-md border border-rose-500/30 bg-slate-950/60 px-3 py-2 text-xs hover:border-rose-400"
          >
            <div>
              <span className="font-semibold text-slate-100">{s.name}</span>
              <span className="ml-2 text-[10px] text-slate-500">{s.code} · {s.market}</span>
            </div>
            <div className="flex items-center gap-2 text-right">
              <span className="text-rose-300 font-medium">+{s.changePct.toFixed(2)}%</span>
              <span className="text-[10px] text-slate-500">
                {s.marketCap !== null ? `시총 ${s.marketCap.toLocaleString('ko-KR')}억` : '시총 ?'}
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function Panel({
  title,
  tone,
  description,
  stocks,
  watchlist,
  showTradingValue,
  onAdded,
}: {
  title: string;
  tone: 'sky' | 'emerald' | 'rose';
  description: string;
  stocks: TrendingStock[];
  watchlist: Map<string, StockScored>;
  showTradingValue?: boolean;
  onAdded: () => void;
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
            <PriceRow
              key={`${s.code}-${s.rank}`}
              stock={s}
              scored={watchlist.get(s.code) ?? null}
              showTradingValue={showTradingValue}
              onAdded={onAdded}
            />
          ))
        )}
      </div>
    </section>
  );
}

function InvestorPanel({
  title,
  tone,
  description,
  flows,
  watchlist,
  onAdded,
}: {
  title: string;
  tone: 'emerald' | 'rose';
  description: string;
  flows: InvestorFlow[];
  watchlist: Map<string, StockScored>;
  onAdded: () => void;
}) {
  const border = tone === 'emerald' ? 'border-emerald-500/40' : 'border-rose-500/40';
  const titleColor = tone === 'emerald' ? 'text-emerald-200' : 'text-rose-200';

  return (
    <section className={`rounded-lg border ${border} bg-slate-900/40`}>
      <div className="border-b border-slate-800 px-4 py-3">
        <div className={`text-sm font-semibold ${titleColor}`}>{title}</div>
        <div className="text-[11px] text-slate-400">{description}</div>
      </div>
      <div className="divide-y divide-slate-800/60">
        {flows.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">데이터 없음</div>
        ) : (
          flows.map((f) => (
            <InvestorRow
              key={`${f.code}-${f.rank}`}
              flow={f}
              scored={watchlist.get(f.code) ?? null}
              onAdded={onAdded}
            />
          ))
        )}
      </div>
    </section>
  );
}

function AddToWatchlistButton({
  code,
  alreadyInWatch,
  onAdded,
}: {
  code: string;
  alreadyInWatch: boolean;
  onAdded: () => void;
}) {
  const [state, setState] = useState<'idle' | 'fetching' | 'done' | 'error'>(
    alreadyInWatch ? 'done' : isInWatchlist(code) ? 'done' : 'idle',
  );
  const [err, setErr] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setState('fetching');
    setErr(null);
    try {
      const res = await fetch(`/api/stock-data?code=${code}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as
        | { stock?: StockRaw; warnings?: string[]; error?: string }
        | null;
      if (!res.ok || !json || json.error || !json.stock) {
        setErr(json?.error ?? `HTTP ${res.status}`);
        setState('error');
        return;
      }
      addOrUpdateDraft(json.stock);
      setState('done');
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <span className="rounded border border-emerald-500/50 bg-emerald-500/10 px-1 text-[10px] text-emerald-300">
        ✓ 워치
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="text-[10px] text-rose-300" title={err ?? 'error'}>
        실패
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'fetching'}
      className="rounded border border-sky-500/60 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
    >
      {state === 'fetching' ? '수집…' : '+ 워치'}
    </button>
  );
}

function PriceRow({
  stock,
  scored,
  showTradingValue,
  onAdded,
}: {
  stock: TrendingStock;
  scored: StockScored | null;
  showTradingValue?: boolean;
  onAdded: () => void;
}) {
  const up = stock.changePct >= 0;
  return (
    <div className="px-4 py-2.5 text-xs hover:bg-slate-900/30">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-5 shrink-0 text-right text-slate-500">{stock.rank}</span>
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
        ) : (
          <AddToWatchlistButton code={stock.code} alreadyInWatch={false} onAdded={onAdded} />
        )}
        <div className="ml-auto flex items-center gap-3 text-right">
          <span className="text-slate-300">{stock.price.toLocaleString('ko-KR')}원</span>
          <span className={`font-medium ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
            {up ? '+' : ''}
            {stock.changePct.toFixed(2)}%
          </span>
          <span className="text-slate-500">{formatVolume(stock.volume)}주</span>
          {showTradingValue ? (
            <span className="hidden text-slate-500 md:inline">
              {stock.tradingValue ? formatValue(stock.tradingValue) : '-'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InvestorRow({
  flow,
  scored,
  onAdded,
}: {
  flow: InvestorFlow;
  scored: StockScored | null;
  onAdded: () => void;
}) {
  return (
    <div className="px-4 py-2.5 text-xs hover:bg-slate-900/30">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-5 shrink-0 text-right text-slate-500">{flow.rank}</span>
        <a
          href={`https://finance.naver.com/item/main.naver?code=${flow.code}`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-slate-100 hover:text-sky-300 hover:underline"
        >
          {flow.name}
        </a>
        <span className="text-[10px] text-slate-500">{flow.code}</span>
        <span className="text-[10px] text-slate-600">{flow.market}</span>
        {scored ? (
          <span className="rounded border border-rose-500/50 bg-rose-500/10 px-1 text-[10px] text-rose-300">
            워치 · {scored.grade}
          </span>
        ) : (
          <AddToWatchlistButton code={flow.code} alreadyInWatch={false} onAdded={onAdded} />
        )}
        <span className="ml-auto text-slate-300">{formatAmount(flow.amount)}</span>
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

function formatAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}조`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}억`;
  if (v > 0) return `${v.toLocaleString('ko-KR')}백만`;
  return '-';
}
