'use client';

import { useEffect, useState } from 'react';
import type { IndexInfo, MarketPulse, StockTiming } from '@/lib/market';

type PositionTone = {
  label: string;
  meaning: string;
  color: string;
};

function describePosition(positionPct: number): PositionTone {
  if (positionPct >= 80) return { label: '신고가권', meaning: '비싼 구간 — 새로 사기 부담', color: 'text-rose-300' };
  if (positionPct >= 60) return { label: '상단권', meaning: '다소 부담 — 신중', color: 'text-amber-300' };
  if (positionPct >= 40) return { label: '중간권', meaning: '가격 부담 보통', color: 'text-slate-300' };
  if (positionPct >= 20) return { label: '하단권', meaning: '다소 저렴 — 관심권', color: 'text-sky-300' };
  return { label: '신저가권', meaning: '충분히 빠짐 — 가치 진입 후보', color: 'text-emerald-300' };
}

function describeChange(changePct: number): { label: string; color: string } {
  const abs = Math.abs(changePct);
  if (abs >= 5) return { label: changePct < 0 ? '패닉 수준 하락' : '이상 급등', color: 'text-rose-300' };
  if (abs >= 3) return { label: changePct < 0 ? '큰 하락' : '큰 상승', color: changePct < 0 ? 'text-rose-300' : 'text-emerald-300' };
  if (abs >= 1) return { label: changePct < 0 ? '의미 있는 하락' : '의미 있는 상승', color: changePct < 0 ? 'text-rose-300' : 'text-emerald-300' };
  if (abs >= 0.3) return { label: '소폭 변동', color: 'text-slate-300' };
  return { label: '거의 보합', color: 'text-slate-400' };
}

function buildOverallMessage(indices: IndexInfo[]): string {
  const kospi = indices.find((i) => i.code === 'KOSPI');
  const kosdaq = indices.find((i) => i.code === 'KOSDAQ');
  if (!kospi || !kosdaq) return '';
  const avgPos = (kospi.positionPct + kosdaq.positionPct) / 2;
  const avgChg = (kospi.changePct + kosdaq.changePct) / 2;

  let posMsg: string;
  if (avgPos >= 80) posMsg = '시장 전체가 신고가권에 있어 비싼 구간';
  else if (avgPos >= 60) posMsg = '시장이 상단권에 있어 가격 부담이 있음';
  else if (avgPos >= 40) posMsg = '시장이 중간 구간';
  else if (avgPos >= 20) posMsg = '시장이 하단권에 있어 다소 저렴';
  else posMsg = '시장이 신저가권에 있어 가치 진입 관심 구간';

  let chgMsg: string;
  if (avgChg <= -5) chgMsg = `오늘 평균 ${avgChg.toFixed(1)}%로 패닉 수준 하락. 일시 조정인지 추세 반전인지는 1~2주 더 봐야 알 수 있음`;
  else if (avgChg <= -3) chgMsg = `오늘 평균 ${avgChg.toFixed(1)}%로 큰 하락. 의미 있는 매도세`;
  else if (avgChg <= -1) chgMsg = `오늘 평균 ${avgChg.toFixed(1)}%로 의미 있는 하락`;
  else if (avgChg >= 5) chgMsg = `오늘 평균 +${avgChg.toFixed(1)}%로 이상 급등. 따라가지 말고 이유 확인 필요`;
  else if (avgChg >= 3) chgMsg = `오늘 평균 +${avgChg.toFixed(1)}%로 큰 상승`;
  else if (avgChg >= 1) chgMsg = `오늘 평균 +${avgChg.toFixed(1)}%로 의미 있는 상승`;
  else chgMsg = `오늘은 평균 ${avgChg >= 0 ? '+' : ''}${avgChg.toFixed(1)}%로 조용한 하루`;

  return `${posMsg}. ${chgMsg}.`;
}

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
          const pos = describePosition(idx.positionPct);
          const chg = describeChange(idx.changePct);
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
              <div className={`mt-1 text-[11px] ${chg.color}`}>오늘: {chg.label}</div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  52주 {idx.week52Low.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ~{' '}
                  {idx.week52High.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
                </span>
                <span className={pos.color}>
                  {pos.label} {idx.positionPct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-1 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400"
                  style={{ width: `${idx.positionPct}%` }}
                />
              </div>
              <div className={`mt-2 text-[11px] ${pos.color}`}>{pos.meaning}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
        <div className="text-[11px] font-semibold text-sky-200">📌 오늘의 시장 메시지</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          {buildOverallMessage(data.indices)}
        </p>
      </div>

      <details className="mt-2 rounded-md border border-slate-800 bg-slate-950/30 p-2 text-[11px] text-slate-400">
        <summary className="cursor-pointer text-slate-300">용어 풀이 (잘 모르겠으면 펴보세요)</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
          <li>
            <strong>KOSPI / KOSDAQ</strong>: 한국 주식 시장 전체의 평균 점수. KOSPI는 대형주
            (삼성전자/현대차 등), KOSDAQ는 중소형주·기술주 중심.
          </li>
          <li>
            <strong>52주 위치 (0~100%)</strong>: 지난 1년 최저~최고 사이 현재 어디인지. 100%면 1년
            최고가 근처, 0%면 1년 최저가 근처. <span className="text-rose-300">신고가권은 비싼 구간</span>,
            <span className="text-emerald-300"> 신저가권은 가치 진입 관심 구간</span>.
          </li>
          <li>
            <strong>오늘 등락률</strong>: 보통 하루 ±0.5~1% 변동이 정상. ±3%는 큰 움직임, ±5% 이상은
            패닉 또는 이상 급등으로 봅니다.
          </li>
          <li>
            <strong>시장 vs 개별 종목</strong>: 시장이 비싸도 개별 종목은 저평가일 수 있습니다.
            아래 "낙폭 후보" 패널이 본인 워치리스트 중 충분히 빠진 종목을 자동으로 잡아줍니다.
          </li>
        </ul>
      </details>
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
