'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import rawStocks from '@/data/stocks.sample.json';
import type { StockRaw, StockScored } from '@/types/stock';
import { scoreStocks } from '@/lib/scoring';
import { runAllLenses, summarize, type LensResult, type LensVerdict } from '@/lib/lenses';
import { useMarketPulse } from '@/components/market-pulse';

type StockWithLenses = {
  raw: StockRaw;
  scored: StockScored;
  lenses: LensResult[];
  passCount: number;
  neutralCount: number;
  overall: '강한 후보' | '후보' | '애매' | '후보 아님';
};

const VERDICT_ORDER: Record<'강한 후보' | '후보' | '애매' | '후보 아님', number> = {
  '강한 후보': 0,
  후보: 1,
  애매: 2,
  '후보 아님': 3,
};

export default function GeniusPage() {
  const { data: pulse } = useMarketPulse();
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const enriched: StockWithLenses[] = useMemo(() => {
    const raws = rawStocks as StockRaw[];
    const scored = scoreStocks(raws);
    return raws.map((raw, i) => {
      const s = scored[i];
      const timing = pulse?.watchlistTiming[raw.code];
      const lenses = runAllLenses(raw, s, timing);
      const summary = summarize(lenses);
      return {
        raw,
        scored: s,
        lenses,
        passCount: summary.pass,
        neutralCount: summary.neutral,
        overall: summary.overall,
      };
    });
  }, [pulse]);

  const sorted = useMemo(
    () =>
      [...enriched].sort((a, b) => {
        const dv = VERDICT_ORDER[a.overall] - VERDICT_ORDER[b.overall];
        if (dv !== 0) return dv;
        if (b.passCount !== a.passCount) return b.passCount - a.passCount;
        return b.scored.totalScore - a.scored.totalScore;
      }),
    [enriched],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">거장의 눈</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            본인 워치리스트 종목을 <strong>5명의 투자 거장</strong> 관점에서 동시에 평가합니다. 한 명이
            아니라 여러 관점으로 본다는 점이 핵심. 통과한 거장 수가 많을수록 다각도에서 매수 후보.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            ← 워치리스트
          </Link>
          <Link
            href="/screener"
            className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
          >
            스크리너 →
          </Link>
          <Link
            href="/trending"
            className="rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
          >
            오늘 뜨는 종목 →
          </Link>
        </div>
      </header>

      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs font-semibold text-slate-300">5명의 거장 — 한 줄 요약</div>
        <ul className="mt-2 grid gap-1 text-[11px] text-slate-400 md:grid-cols-2">
          <li>
            <strong className="text-slate-200">버핏</strong> — 꾸준히 돈 벌고 부채 없는 회사를 적정가에
          </li>
          <li>
            <strong className="text-slate-200">그린블라트</strong> — Earnings Yield + ROE (싸면서 좋은
            회사)
          </li>
          <li>
            <strong className="text-slate-200">린치</strong> — PEG (성장 대비 가격이 싼지)
          </li>
          <li>
            <strong className="text-slate-200">마크스</strong> — 충분히 빠진 우량주 (역발상)
          </li>
          <li>
            <strong className="text-slate-200">내 모델</strong> — 종합 품질 점수 (S/A 합격)
          </li>
        </ul>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <div className="divide-y divide-slate-800/60">
          {sorted.map((row) => (
            <StockLensRow
              key={row.raw.code}
              row={row}
              expanded={expandedCode === row.raw.code}
              onToggle={() => setExpandedCode(expandedCode === row.raw.code ? null : row.raw.code)}
            />
          ))}
        </div>
      </section>

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">⚠️ 사용 시 주의</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>각 렌즈는 단년 재무 데이터 기반의 근사치입니다. 실제 거장들은 5~10년 누적 데이터를 봅니다.</li>
          <li>"5명 중 X명 통과"는 매수 신호가 아니라 다각도 평가일 뿐입니다.</li>
          <li>같은 종목도 사업 모델·산업 사이클·매크로 환경에 따라 평가가 달라집니다.</li>
          <li>마크스 렌즈는 52주 위치 데이터가 도착해야 정확. 처음엔 "평가 보류"일 수 있음.</li>
        </ul>
      </div>

      <footer className="mt-10 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        본 화면은 학습·판단 보조 도구이며 매수·매도 추천이 아닙니다.
      </footer>
    </main>
  );
}

function StockLensRow({
  row,
  expanded,
  onToggle,
}: {
  row: StockWithLenses;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-12 items-center gap-2 px-4 py-3 text-left text-xs hover:bg-slate-900/60"
      >
        <div className="col-span-12 md:col-span-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-100">{row.raw.name}</span>
            <span className="text-[10px] text-slate-500">{row.raw.code}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            {row.raw.market} · {row.raw.industry}
          </div>
        </div>
        <div className="col-span-8 md:col-span-7">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.lenses.map((l) => (
              <VerdictChip key={l.key} label={l.shortName} verdict={l.verdict} />
            ))}
          </div>
        </div>
        <div className="col-span-4 text-right md:col-span-2">
          <OverallBadge overall={row.overall} pass={row.passCount} />
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-800/60 bg-slate-950/40 px-4 py-4">
          {row.lenses.map((l) => (
            <LensDetail key={l.key} lens={l} />
          ))}
          <div className="rounded border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400">
            <strong className="text-slate-200">{row.raw.name}</strong> 종합:{' '}
            <strong className="text-slate-100">{row.passCount}명 통과</strong> ·{' '}
            {row.neutralCount}명 애매 · {5 - row.passCount - row.neutralCount}명 실격 →{' '}
            <strong className="text-slate-100">{row.overall}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VerdictChip({ label, verdict }: { label: string; verdict: LensVerdict }) {
  const cls =
    verdict === 'pass'
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
      : verdict === 'neutral'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-slate-700 bg-slate-800/60 text-slate-400';
  const icon = verdict === 'pass' ? '✓' : verdict === 'neutral' ? '⚠' : '✗';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] ${cls}`}>
      {icon} {label}
    </span>
  );
}

function OverallBadge({ overall, pass }: { overall: StockWithLenses['overall']; pass: number }) {
  const cls =
    overall === '강한 후보'
      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
      : overall === '후보'
      ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
      : overall === '애매'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return (
    <span className={`inline-block rounded-md border px-2 py-1 text-[11px] font-semibold ${cls}`}>
      {overall} · {pass}/5
    </span>
  );
}

function LensDetail({ lens }: { lens: LensResult }) {
  const verdictColor =
    lens.verdict === 'pass'
      ? 'text-emerald-300'
      : lens.verdict === 'neutral'
      ? 'text-amber-300'
      : 'text-slate-400';
  const verdictLabel =
    lens.verdict === 'pass' ? '통과 ✓' : lens.verdict === 'neutral' ? '애매 ⚠' : '실격 ✗';
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-slate-100">{lens.name}</span>
          <span className="ml-2 text-[10px] text-slate-500">{lens.philosophy}</span>
        </div>
        <span className={`text-xs font-medium ${verdictColor}`}>{verdictLabel}</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-slate-300">
        {lens.reasons.map((r, i) => (
          <li key={i}>· {r}</li>
        ))}
      </ul>
    </div>
  );
}
