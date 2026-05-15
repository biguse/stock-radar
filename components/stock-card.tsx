'use client';

import { useState } from 'react';
import type { ActionSuggestion, Grade, StockScored } from '@/types/stock';
import type { StockTiming } from '@/lib/market';
import { MemoBox } from '@/components/memo-box';
import { TimingBadge } from '@/components/market-pulse';

type Props = {
  stock: StockScored;
  initialHasMemo: boolean;
  timing?: StockTiming;
};

const GRADE_STYLE: Record<Grade, string> = {
  S: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/60',
  A: 'bg-sky-500/20 text-sky-200 border-sky-400/60',
  B: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/60',
  C: 'bg-amber-500/20 text-amber-200 border-amber-400/60',
  D: 'bg-orange-500/20 text-orange-200 border-orange-400/60',
  X: 'bg-rose-500/20 text-rose-200 border-rose-400/60',
};

const ACTION_STYLE: Record<ActionSuggestion, string> = {
  '깊게 보기': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
  관찰: 'bg-sky-500/10 text-sky-300 border-sky-500/40',
  대기: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
  피함: 'bg-rose-500/10 text-rose-300 border-rose-500/40',
};

export function StockCard({ stock, initialHasMemo, timing }: Props) {
  const [hasMemo, setHasMemo] = useState(initialHasMemo);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-100">{stock.name}</h3>
            <span className="text-xs text-slate-500">{stock.code}</span>
            {hasMemo ? (
              <span className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                메모 있음
              </span>
            ) : null}
            <TimingBadge timing={timing} />
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {stock.market} · {stock.industry}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${GRADE_STYLE[stock.grade]}`}
            >
              {stock.grade}
            </span>
            <span className="text-2xl font-bold text-slate-100">{stock.totalScore}</span>
            <span className="text-xs text-slate-500">/100</span>
          </div>
          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] ${ACTION_STYLE[stock.action]}`}
          >
            행동: {stock.action}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-200">{stock.oneLineJudgment}</p>

      <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-6">
        <ScoreCell label="성장성" value={stock.score.growth} max={25} />
        <ScoreCell label="수익성" value={stock.score.profitability} max={20} />
        <ScoreCell label="현금흐름" value={stock.score.cashFlow} max={20} />
        <ScoreCell label="재무안정성" value={stock.score.stability} max={15} />
        <ScoreCell label="밸류에이션" value={stock.score.valuation} max={10} />
        <ScoreCell label="모멘텀" value={stock.score.momentum} max={10} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
        <MetricLine label="PER" value={fmtRatio(stock.per)} />
        <MetricLine label="PBR" value={fmtRatio(stock.pbr)} />
        <MetricLine label="ROE" value={`${stock.roe.toFixed(1)}%`} />
        <MetricLine label="부채비율" value={`${stock.debtRatio.toFixed(0)}%`} />
        <MetricLine label="영업현금흐름" value={fmtAmount(stock.operatingCashFlow)} />
        <MetricLine label="매출 증가율" value={`${signed(stock.revenueGrowthRate)}%`} />
        <MetricLine label="영업이익 증가율" value={`${signed(stock.operatingProfitGrowthRate)}%`} />
        <MetricLine label="당기순이익" value={fmtAmount(stock.netIncome)} />
        <MetricLine label="3M 모멘텀" value={`${signed(stock.momentum3m)}%`} />
      </div>

      {stock.risks.length > 0 || stock.operatingCashFlowTwoYearsNegative ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {stock.risks.map((r) => (
            <span
              key={r}
              className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200"
            >
              DART · {r}
            </span>
          ))}
          {stock.operatingCashFlowTwoYearsNegative && !stock.risks.includes('영업현금흐름 2년 연속 음수') ? (
            <span className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">
              DART · 영업현금흐름 2년 연속 음수
            </span>
          ) : null}
          {stock.isForcedExcluded ? (
            <span className="rounded-md border border-rose-400 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-100">
              강제 X
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ReasonBlock title="왜 올라왔나" tone="good" items={stock.whyGood} />
        <ReasonBlock title="왜 위험한가" tone="bad" items={stock.whyRisky} />
      </div>

      <MemoBox code={stock.code} onMemoChange={setHasMemo} />
    </div>
  );
}

function ScoreCell({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max === 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">
        {value}
        <span className="text-[10px] text-slate-500">/{max}</span>
      </div>
      <div className="mt-1 h-1 w-full rounded-full bg-slate-800">
        <div
          className="h-1 rounded-full bg-sky-400"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-800/60 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  );
}

function ReasonBlock({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'good' | 'bad';
  items: string[];
}) {
  const border = tone === 'good' ? 'border-emerald-500/30' : 'border-rose-500/30';
  const titleColor = tone === 'good' ? 'text-emerald-300' : 'text-rose-300';
  return (
    <div className={`rounded-md border ${border} bg-slate-950/40 p-3`}>
      <div className={`text-xs font-semibold ${titleColor}`}>{title}</div>
      <ul className="mt-2 space-y-1 text-xs text-slate-300">
        {items.map((item, idx) => (
          <li key={idx} className="leading-relaxed">
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtRatio(value: number | null): string {
  if (value === null) return '-';
  return `${value.toFixed(1)}배`;
}

function fmtAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}조원`;
  return `${sign}${abs.toLocaleString('ko-KR')}억원`;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
