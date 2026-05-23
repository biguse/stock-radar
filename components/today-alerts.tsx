'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { StockRaw, StockScored } from '@/types/stock';
import type { InvestorFlow, TrendingResult, TrendingStock } from '@/lib/trending';
import type { MarketPulse, StockTiming } from '@/lib/market';

type Props = {
  watchlistScored: Map<string, StockScored>;
  pulse: MarketPulse | null;
};

type Alert = {
  key: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'indigo';
  title: string;
  body: string;
  href?: string;
};

function isFollowable(grade: StockScored['grade']): boolean {
  return grade === 'S' || grade === 'A' || grade === 'B';
}

export function TodayAlerts({ watchlistScored, pulse }: Props) {
  const [trending, setTrending] = useState<TrendingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/trending', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as
          | (TrendingResult & { error?: string })
          | null;
        if (cancelled) return;
        if (!res.ok || !json || json.error) {
          setError(json?.error ?? `HTTP ${res.status}`);
        } else {
          setTrending(json);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const alerts = useMemo(
    () => buildAlerts(watchlistScored, pulse, trending),
    [watchlistScored, pulse, trending],
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        오늘의 알림 불러오는 중…
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        오늘 본인 워치리스트에 특이 신호가 없습니다.
        {error ? <span className="ml-1 text-rose-400">(트렌딩 로딩 실패: {error})</span> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 text-xs font-semibold text-slate-300">📌 오늘의 알림</div>
      <div className="grid gap-2 md:grid-cols-2">
        {alerts.map((a) => (
          <AlertCard key={a.key} alert={a} />
        ))}
      </div>
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const styles: Record<Alert['tone'], string> = {
    sky: 'border-sky-500/40 bg-sky-500/5 text-sky-100',
    emerald: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-100',
    amber: 'border-amber-500/40 bg-amber-500/5 text-amber-100',
    rose: 'border-rose-500/40 bg-rose-500/5 text-rose-100',
    indigo: 'border-indigo-500/40 bg-indigo-500/5 text-indigo-100',
  };
  const titleStyles: Record<Alert['tone'], string> = {
    sky: 'text-sky-300',
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    rose: 'text-rose-300',
    indigo: 'text-indigo-300',
  };
  const content = (
    <div className={`rounded-md border ${styles[alert.tone]} px-3 py-2`}>
      <div className={`text-xs font-semibold ${titleStyles[alert.tone]}`}>{alert.title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-slate-300">{alert.body}</div>
    </div>
  );
  if (alert.href) {
    return (
      <Link href={alert.href} className="block transition hover:opacity-80">
        {content}
      </Link>
    );
  }
  return content;
}

function buildAlerts(
  watchlist: Map<string, StockScored>,
  pulse: MarketPulse | null,
  trending: TrendingResult | null,
): Alert[] {
  const alerts: Alert[] = [];

  // 1. Market pulse summary
  if (pulse) {
    const kospi = pulse.indices.find((i) => i.code === 'KOSPI');
    const kosdaq = pulse.indices.find((i) => i.code === 'KOSDAQ');
    if (kospi && kosdaq) {
      const avgPos = (kospi.positionPct + kosdaq.positionPct) / 2;
      const avgChg = (kospi.changePct + kosdaq.changePct) / 2;
      let tone: Alert['tone'] = 'sky';
      let title = '시장 상황';
      let body = '';
      if (avgPos >= 80 && avgChg <= -3) {
        tone = 'amber';
        title = '⚡ 신고가권에서 큰 하락';
        body = `KOSPI ${kospi.changePct.toFixed(2)}% / KOSDAQ ${kosdaq.changePct.toFixed(2)}%. 일시 조정인지 추세 반전인지 1~2주 관찰 필요.`;
      } else if (avgPos >= 80) {
        tone = 'rose';
        title = '🔴 시장 신고가권';
        body = `KOSPI ${kospi.positionPct.toFixed(0)}% / KOSDAQ ${kosdaq.positionPct.toFixed(0)}% — 새로 사기 부담 구간.`;
      } else if (avgPos <= 30) {
        tone = 'emerald';
        title = '🟢 시장 저점권';
        body = `KOSPI ${kospi.positionPct.toFixed(0)}% / KOSDAQ ${kosdaq.positionPct.toFixed(0)}% — 가치 진입 관심 구간.`;
      } else if (Math.abs(avgChg) >= 3) {
        tone = avgChg > 0 ? 'emerald' : 'rose';
        title = avgChg > 0 ? '📈 오늘 큰 상승' : '📉 오늘 큰 하락';
        body = `KOSPI ${kospi.changePct.toFixed(2)}% / KOSDAQ ${kosdaq.changePct.toFixed(2)}%.`;
      } else {
        title = '시장 평온';
        body = `KOSPI ${kospi.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} (${kospi.changePct >= 0 ? '+' : ''}${kospi.changePct.toFixed(2)}%) · KOSDAQ ${kosdaq.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} (${kosdaq.changePct >= 0 ? '+' : ''}${kosdaq.changePct.toFixed(2)}%)`;
      }
      alerts.push({ key: 'market', tone, title, body });
    }
  }

  // 2. Dip candidates from watchlist (in volume + S/A/B + today <= -2%)
  if (trending) {
    const volumeCodes = new Set(trending.volume.map((s) => s.code));
    const dipCandidates: TrendingStock[] = [];
    for (const s of [...trending.volume, ...trending.losers]) {
      const w = watchlist.get(s.code);
      if (!w || !isFollowable(w.grade)) continue;
      if (s.changePct > -2) continue;
      if (!volumeCodes.has(s.code)) continue;
      if (dipCandidates.some((x) => x.code === s.code)) continue;
      dipCandidates.push(s);
    }
    dipCandidates.sort((a, b) => a.changePct - b.changePct);
    if (dipCandidates.length > 0) {
      const top = dipCandidates.slice(0, 3);
      alerts.push({
        key: 'dips',
        tone: 'sky',
        title: '🔵 분할매수 후보',
        body: top
          .map((s) => `${s.name} ${s.changePct.toFixed(2)}%`)
          .join(' · '),
        href: '/trending',
      });
    }

    // 3. 외국인이 사고 있는 워치리스트 종목
    const foreignWatch = trending.foreignBuy.filter((f) => {
      const w = watchlist.get(f.code);
      return w !== undefined && isFollowable(w.grade);
    });
    if (foreignWatch.length > 0) {
      const top: InvestorFlow[] = foreignWatch.slice(0, 3);
      alerts.push({
        key: 'foreign',
        tone: 'indigo',
        title: '👥 외국인이 사는 내 종목',
        body: top.map((f) => `${f.name} ${(f.amount / 10000).toFixed(1)}억`).join(' · '),
        href: '/trending',
      });
    }

    // 4. 작전주 의심 — 워치리스트 종목이 등장하면 강조
    const pumpInWatch = trending.pumpRisk.filter((s) => watchlist.has(s.code));
    if (pumpInWatch.length > 0) {
      alerts.push({
        key: 'pump-watch',
        tone: 'rose',
        title: '⚠️ 워치리스트 종목이 작전주 의심',
        body: pumpInWatch
          .slice(0, 3)
          .map((s) => `${s.name} +${s.changePct.toFixed(2)}%`)
          .join(' · '),
        href: '/trending',
      });
    } else if (trending.pumpRisk.length >= 3) {
      // 일반 작전주 의심 알림 (참고용)
      alerts.push({
        key: 'pump-general',
        tone: 'amber',
        title: '⚠️ 오늘 작전주 의심 종목 다수',
        body: `${trending.pumpRisk.length}개 종목이 시총 1,000억 미만 + 15% 이상 급등. 충동매수 금지.`,
        href: '/trending',
      });
    }
  }

  // 5. 52주 신고가 -15% 이상 빠진 워치리스트 종목 (낙폭 후보)
  if (pulse) {
    const pullback: { name: string; code: string; drop: number; grade: StockScored['grade']; score: number }[] = [];
    watchlist.forEach((w, code) => {
      if (!isFollowable(w.grade)) return;
      const t = pulse.watchlistTiming[code];
      if (!t || t.dropFromHighPct > -15) return;
      pullback.push({ name: w.name, code, drop: t.dropFromHighPct, grade: w.grade, score: w.totalScore });
    });
    pullback.sort((a, b) => a.drop - b.drop);
    if (pullback.length > 0) {
      const top = pullback.slice(0, 3);
      alerts.push({
        key: 'pullback',
        tone: 'emerald',
        title: '🟢 낙폭 후보 (52주 신고가 -15%↓)',
        body: top.map((s) => `${s.name} 신고가 ${s.drop.toFixed(1)}%`).join(' · '),
        href: '/trending',
      });
    }
  }

  return alerts;
}
