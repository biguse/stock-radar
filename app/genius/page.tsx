'use client';

import { useEffect, useMemo, useState } from 'react';
import rawStocks from '@/data/stocks.sample.json';
import type { StockRaw, StockScored } from '@/types/stock';
import { scoreStocks } from '@/lib/scoring';
import { runAllLenses, summarize, type LensResult, type LensVerdict } from '@/lib/lenses';
import { useMarketPulse } from '@/components/market-pulse';
import {
  addOrUpdateDraft,
  getFullWatchlist,
  isInWatchlist,
  moveStock,
  removeFromWatchlist,
} from '@/lib/watchlist-storage';

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

type GeniusSortMode = 'verdict' | 'custom';
type ScanSource = 'watchlist' | 'volume' | 'cap' | 'gainers' | 'foreign-buy' | 'magic';

const SCAN_LABELS: Record<ScanSource, string> = {
  watchlist: '내 워치리스트',
  volume: '거래량 Top',
  cap: '시총 Top',
  gainers: '급등 Top',
  'foreign-buy': '외국인 매수 Top',
  magic: '마법공식 Top',
};

export default function GeniusPage() {
  const { data: pulse } = useMarketPulse();
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [stocks, setStocks] = useState<StockRaw[]>(rawStocks as StockRaw[]);
  const [sortMode, setSortMode] = useState<GeniusSortMode>('verdict');
  const refreshStocks = () => setStocks(getFullWatchlist());

  // Scan mode state
  const [scanSource, setScanSource] = useState<ScanSource>('watchlist');
  const [scanLimit, setScanLimit] = useState<number>(20);
  const [scanData, setScanData] = useState<StockRaw[] | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<string | null>(null);

  useEffect(() => {
    refreshStocks();
  }, []);

  async function runScan(source: ScanSource, limit: number) {
    setScanSource(source);
    if (source === 'watchlist') {
      setScanData(null);
      setScanError(null);
      setScanProgress(null);
      return;
    }
    setScanLoading(true);
    setScanError(null);
    setScanData(null);
    setScanProgress('상위 종목 목록 가져오는 중…');
    try {
      let codes: string[] = [];
      if (source === 'cap' || source === 'magic') {
        const res = await fetch('/api/screener', { cache: 'no-store' });
        const json = (await res.json()) as { top?: { code: string }[]; error?: string };
        if (json.error) throw new Error(json.error);
        codes = (json.top ?? []).slice(0, limit).map((s) => s.code);
      } else {
        const res = await fetch('/api/trending', { cache: 'no-store' });
        const json = (await res.json()) as {
          volume?: { code: string }[];
          gainers?: { code: string }[];
          foreignBuy?: { code: string }[];
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        if (source === 'volume') codes = (json.volume ?? []).slice(0, limit).map((s) => s.code);
        else if (source === 'gainers') codes = (json.gainers ?? []).slice(0, limit).map((s) => s.code);
        else if (source === 'foreign-buy') codes = (json.foreignBuy ?? []).slice(0, limit).map((s) => s.code);
      }
      if (codes.length === 0) throw new Error('해당 출처에서 종목을 못 가져왔습니다');

      const eta = Math.ceil(codes.length / 4) * 3;
      setScanProgress(`${codes.length}개 종목 재무·DART 데이터 수집 중… (${eta}초 정도 소요)`);
      const res2 = await fetch(`/api/universe?codes=${codes.join(',')}`, { cache: 'no-store' });
      const json2 = (await res2.json()) as {
        results?: Array<{ code: string; ok: boolean; stock?: StockRaw; error?: string }>;
        error?: string;
      };
      if (json2.error) throw new Error(json2.error);
      const okStocks = (json2.results ?? [])
        .filter((r): r is { code: string; ok: true; stock: StockRaw } => r.ok && r.stock !== undefined)
        .map((r) => r.stock);
      setScanData(okStocks);
      setScanProgress(`${okStocks.length}/${codes.length}개 완료${okStocks.length < codes.length ? ' (일부 실패)' : ''}`);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'unknown error');
      setScanProgress(null);
    } finally {
      setScanLoading(false);
    }
  }

  const stocksForLenses: StockRaw[] = scanSource === 'watchlist' ? stocks : scanData ?? [];

  const enriched: StockWithLenses[] = useMemo(() => {
    const scored = scoreStocks(stocksForLenses);
    return stocksForLenses.map((raw, i) => {
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
  }, [stocksForLenses, pulse]);

  const sorted = useMemo(() => {
    if (sortMode === 'custom' && scanSource === 'watchlist') return enriched;
    return [...enriched].sort((a, b) => {
      const dv = VERDICT_ORDER[a.overall] - VERDICT_ORDER[b.overall];
      if (dv !== 0) return dv;
      if (b.passCount !== a.passCount) return b.passCount - a.passCount;
      return b.scored.totalScore - a.scored.totalScore;
    });
  }, [enriched, sortMode, scanSource]);

  const isWatchlistMode = scanSource === 'watchlist';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">거장의 눈</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          본인 워치리스트 또는 거래량/시총 상위 종목을 <strong>5명의 투자 거장</strong> 관점에서
          동시에 평가합니다. 통과한 거장 수가 많을수록 다각도에서 매수 후보.
        </p>
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

      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="text-xs font-semibold text-slate-300">분석 대상</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {(Object.keys(SCAN_LABELS) as ScanSource[]).map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => runScan(src, scanLimit)}
              disabled={scanLoading}
              className={`rounded-md border px-3 py-1 transition disabled:opacity-50 ${
                scanSource === src
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
              }`}
            >
              {SCAN_LABELS[src]}
            </button>
          ))}
        </div>
        {!isWatchlistMode ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">개수</span>
            {[10, 20, 30].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => runScan(scanSource, n)}
                disabled={scanLoading}
                className={`rounded-md border px-3 py-1 transition disabled:opacity-50 ${
                  scanLimit === n
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
        {scanProgress ? (
          <div className="mt-2 rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1 text-[11px] text-sky-200">
            {scanProgress}
          </div>
        ) : null}
        {scanError ? (
          <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
            실패: {scanError}
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">정렬</span>
        {(
          [
            { key: 'verdict' as const, label: '거장 평가 순' },
            { key: 'custom' as const, label: '내 순서 (편집 가능, 워치리스트만)' },
          ]
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setSortMode(opt.key)}
            className={`rounded-md border px-3 py-1 transition ${
              sortMode === opt.key
                ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <div className="divide-y divide-slate-800/60">
          {sorted.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              {scanLoading ? '데이터 수집 중…' : isWatchlistMode ? '워치리스트가 비어있습니다' : '결과 없음'}
            </div>
          ) : (
            sorted.map((row, idx) => {
              const inWatch = isInWatchlist(row.raw.code);
              return (
                <StockLensRow
                  key={row.raw.code}
                  row={row}
                  expanded={expandedCode === row.raw.code}
                  onToggle={() => setExpandedCode(expandedCode === row.raw.code ? null : row.raw.code)}
                  onRemove={isWatchlistMode ? () => {
                    if (confirm(`${row.raw.name} (${row.raw.code})을(를) 워치리스트에서 제거할까요?`)) {
                      removeFromWatchlist(row.raw.code);
                      refreshStocks();
                    }
                  } : undefined}
                  onMoveUp={isWatchlistMode && sortMode === 'custom' ? () => {
                    moveStock(row.raw.code, 'up');
                    refreshStocks();
                  } : undefined}
                  onMoveDown={isWatchlistMode && sortMode === 'custom' ? () => {
                    moveStock(row.raw.code, 'down');
                    refreshStocks();
                  } : undefined}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < sorted.length - 1}
                  showAddButton={!isWatchlistMode && !inWatch}
                  inWatchlist={inWatch}
                  onAdd={() => {
                    addOrUpdateDraft(row.raw);
                    refreshStocks();
                  }}
                />
              );
            })
          )}
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
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  showAddButton,
  inWatchlist,
  onAdd,
}: {
  row: StockWithLenses;
  expanded: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  showAddButton?: boolean;
  inWatchlist?: boolean;
  onAdd?: () => void;
}) {
  const showControls = onRemove || onMoveUp || onMoveDown || showAddButton || inWatchlist;
  return (
    <div>
      {showControls ? (
        <div className="flex items-center gap-1 border-b border-transparent px-4 pt-2 text-[10px]">
          {onMoveUp ? (
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              title="위로"
              className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500 disabled:opacity-30"
            >
              ↑
            </button>
          ) : null}
          {onMoveDown ? (
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              title="아래로"
              className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500 disabled:opacity-30"
            >
              ↓
            </button>
          ) : null}
          {inWatchlist && !onRemove ? (
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
              ✓ 워치리스트
            </span>
          ) : null}
          {showAddButton && onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              title="워치리스트에 추가"
              className="rounded border border-sky-500/60 bg-sky-500/10 px-1.5 py-0.5 text-sky-200 hover:bg-sky-500/20"
            >
              + 워치리스트
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              title="워치리스트에서 제거"
              className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300"
            >
              × 제거
            </button>
          ) : null}
        </div>
      ) : null}
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
