'use client';

import { useEffect, useState } from 'react';
import type { MarketPulse, StockTiming } from '@/lib/market';

type ApiResponse = MarketPulse & {
  cached?: boolean;
  stale?: boolean;
  warning?: string;
  error?: string;
};

type ContextValue = {
  data: MarketPulse | null;
  stale: boolean;
  warning: string | null;
};

export function useMarketPulse(): ContextValue & { loading: boolean; error: string | null } {
  const [data, setData] = useState<MarketPulse | null>(null);
  const [stale, setStale] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/market', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as ApiResponse | null;
        if (cancelled) return;
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
        setStale(Boolean(json.stale));
        setWarning(json.warning ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, stale, warning, loading, error };
}

export function MarketPulseWidget() {
  const { data, stale, warning, loading, error } = useMarketPulse();

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        시장 상황 불러오는 중…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
        시장 상황 로딩 실패{error ? ` — ${error}` : ''}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-300">시장 상황</div>
        {stale ? (
          <span className="text-[10px] text-amber-300">⚠️ 이전 데이터{warning ? ` (${warning})` : ''}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.indices.map((idx) => {
          const up = idx.changePct >= 0;
          const positionLabel =
            idx.positionPct >= 80
              ? '신고가권'
              : idx.positionPct >= 60
              ? '상단권'
              : idx.positionPct >= 40
              ? '중간권'
              : idx.positionPct >= 20
              ? '하단권'
              : '신저가권';
          const positionColor =
            idx.positionPct >= 80
              ? 'text-rose-300'
              : idx.positionPct >= 60
              ? 'text-amber-300'
              : idx.positionPct >= 40
              ? 'text-slate-300'
              : idx.positionPct >= 20
              ? 'text-sky-300'
              : 'text-emerald-300';
          return (
            <div key={idx.code} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-100">{idx.code}</span>
                <span className={`text-sm font-medium ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {idx.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}{' '}
                  <span className="text-xs">
                    {up ? '+' : ''}
                    {idx.changePct.toFixed(2)}%
                  </span>
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  52주 {idx.week52Low.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ~{' '}
                  {idx.week52High.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
                </span>
                <span className={positionColor}>
                  {positionLabel} ({idx.positionPct.toFixed(0)}%)
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-1 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400"
                  style={{ width: `${idx.positionPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimingBadge({ timing }: { timing: StockTiming | undefined }) {
  if (!timing) return null;
  const drop = timing.dropFromHighPct;
  const tone =
    drop <= -25
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
      : drop <= -15
      ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
      : drop <= -5
      ? 'border-slate-700 bg-slate-800/60 text-slate-300'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>
      52주 신고가 {drop.toFixed(1)}%
    </span>
  );
}
