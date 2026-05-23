'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import rawStocks from '@/data/stocks.sample.json';
import type { FilterState, SortKey, StockRaw } from '@/types/stock';
import { scoreStocks } from '@/lib/scoring';
import { applyFilters, applySort, DEFAULT_FILTER } from '@/lib/filters';
import { Filters } from '@/components/filters';
import { SummaryCards } from '@/components/summary-cards';
import { StockCard } from '@/components/stock-card';
import { MarketPulseWidget, useMarketPulse } from '@/components/market-pulse';

const MEMO_PREFIX = 'stock-radar:memo:';

export default function Page() {
  const allScored = useMemo(() => scoreStocks(rawStocks as StockRaw[]), []);

  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [sortKey, setSortKey] = useState<SortKey>('totalScore');
  const [memoCodes, setMemoCodes] = useState<Set<string>>(new Set());
  const { data: pulse } = useMarketPulse();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const found = new Set<string>();
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(MEMO_PREFIX)) continue;
      const value = window.localStorage.getItem(key);
      if (value && value.trim().length > 0) {
        found.add(key.slice(MEMO_PREFIX.length));
      }
    }
    setMemoCodes(found);
  }, []);

  const visible = useMemo(() => {
    const filtered = applyFilters(allScored, filter);
    return applySort(filtered, sortKey);
  }, [allScored, filter, sortKey]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">매수 후보 레이더</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            지금 살 만한 후보인지, 더 기다릴 종목인지, 아예 피할 종목인지 빠르게 가르는 개인 투자 판단
            도구입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/genius"
            className="rounded-md border border-indigo-500/60 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/20"
          >
            거장의 눈 →
          </Link>
          <Link
            href="/screener"
            className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
          >
            저평가 우량 스크리너 →
          </Link>
          <Link
            href="/trending"
            className="rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
          >
            오늘 뜨는 종목 →
          </Link>
        </div>
      </header>

      <section className="mb-6">
        <MarketPulseWidget />
      </section>

      <section className="mb-6">
        <SummaryCards stocks={allScored} />
      </section>

      <section className="mb-6">
        <Filters
          filter={filter}
          onFilterChange={setFilter}
          sortKey={sortKey}
          onSortChange={setSortKey}
        />
      </section>

      <section className="mb-3 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {visible.length}개 종목 표시 (전체 {allScored.length}개 중)
        </div>
      </section>

      <section className="space-y-4">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            조건에 맞는 종목이 없습니다. 필터를 조정해 보세요.
          </div>
        ) : (
          visible.map((stock) => (
            <StockCard
              key={stock.code}
              stock={stock}
              initialHasMemo={memoCodes.has(stock.code)}
              timing={pulse?.watchlistTiming[stock.code]}
            />
          ))
        )}
      </section>

      <footer className="mt-10 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        본 화면은 개인 투자 판단 보조 도구이며, 특정 종목의 매수·매도 추천이 아닙니다. 모든 투자 결과의
        책임은 본인에게 있습니다.
      </footer>
    </main>
  );
}
