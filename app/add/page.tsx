'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { StockRaw } from '@/types/stock';
import {
  addOrUpdateDraft,
  getDraftWatchlist,
  isCoreStock,
  isDraftStock,
  removeDraft,
} from '@/lib/watchlist-storage';
import { scoreStock } from '@/lib/scoring';

type StockDataResponse = {
  stock?: StockRaw;
  warnings?: string[];
  cached?: boolean;
  error?: string;
};

type UniverseResultItem =
  | { code: string; ok: true; stock: StockRaw; warnings: string[] }
  | { code: string; ok: false; error: string };

type UniverseResponse = {
  requested: number;
  successful: number;
  failed: number;
  results: UniverseResultItem[];
  error?: string;
};

type BulkSource = 'magic' | 'volume' | 'gainers' | 'foreign-buy';

type BulkCandidate = { code: string; name: string; market: string; hint?: string };

export default function AddPage() {
  const [drafts, setDrafts] = useState<StockRaw[]>([]);
  useEffect(() => {
    setDrafts(getDraftWatchlist());
  }, []);

  function refreshDrafts() {
    setDrafts(getDraftWatchlist());
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">종목 추가</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            DART OpenAPI + 네이버 금융에서 자동으로 데이터를 가져와 워치리스트에 추가합니다. 추가된 종목은
            이 브라우저에 저장되며 즉시 메인 / 거장의 눈 / 트렌딩에 반영됩니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            ← 워치리스트
          </Link>
        </div>
      </header>

      <SingleAddSection onAdded={refreshDrafts} />

      <BulkAddSection onAdded={refreshDrafts} />

      <DraftsSection drafts={drafts} onChanged={refreshDrafts} />

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">⚠️ 사용 시 주의</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>드래프트 워치리스트는 <strong>이 브라우저 localStorage</strong>에 저장됩니다. 다른 기기에선 안 보입니다.</li>
          <li>핵심 워치리스트(코드에 박힌 7개)는 삭제할 수 없습니다. 드래프트만 추가/삭제 가능.</li>
          <li>DART API 키가 설정 안 되어 있으면 자동 데이터 추가가 실패합니다. README의 DART 설정 참고.</li>
          <li>가져온 데이터 일부 항목(특히 비정상 종목)은 0이거나 누락될 수 있습니다. 점수가 이상하면 종목코드로 직접 확인.</li>
        </ul>
      </div>

      <footer className="mt-10 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
        본 화면은 개인 판단 보조 도구이며 매수·매도 추천이 아닙니다.
      </footer>
    </main>
  );
}

function SingleAddSection({ onAdded }: { onAdded: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<StockRaw | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function fetchPreview() {
    setError(null);
    setPreview(null);
    setWarnings([]);
    if (!/^\d{6}$/.test(code)) {
      setError('6자리 종목코드를 입력하세요 (예: 005930)');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/stock-data?code=${code}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as StockDataResponse | null;
      if (!res.ok || !json || json.error || !json.stock) {
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      setPreview(json.stock);
      setWarnings(json.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  function confirmAdd() {
    if (!preview) return;
    if (isCoreStock(preview.code)) {
      setError('이미 핵심 워치리스트에 있는 종목입니다');
      return;
    }
    addOrUpdateDraft(preview);
    onAdded();
    setCode('');
    setPreview(null);
    setWarnings([]);
  }

  const scored = useMemo(() => (preview ? scoreStock(preview) : null), [preview]);

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-sm font-semibold text-slate-200">단일 추가</div>
      <div className="mt-1 text-[11px] text-slate-400">종목코드 6자리 입력 → 자동 데이터 수집 → 미리보기 → 추가</div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          placeholder="예: 005930"
          className="w-40 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={fetchPreview}
          disabled={loading}
          className="rounded-md border border-sky-500 bg-sky-500/20 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
        >
          {loading ? '가져오는 중…' : '가져오기'}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3 space-y-2 rounded-md border border-slate-700 bg-slate-950/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{preview.name}</span>
            <span className="text-xs text-slate-500">{preview.code}</span>
            <span className="text-xs text-slate-500">
              {preview.market} · {preview.industry}
            </span>
            {scored ? (
              <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                예상: {scored.grade} · {scored.totalScore}점
              </span>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-300 md:grid-cols-3">
            <li>매출 +{preview.revenueGrowthRate.toFixed(1)}%</li>
            <li>영업이익 {preview.operatingProfitGrowthRate >= 0 ? '+' : ''}{preview.operatingProfitGrowthRate.toFixed(1)}%</li>
            <li>당기순이익 {preview.netIncome.toLocaleString('ko-KR')}억</li>
            <li>OCF {preview.operatingCashFlow.toLocaleString('ko-KR')}억</li>
            <li>부채비율 {preview.debtRatio}%</li>
            <li>PER {preview.per ?? '-'}</li>
            <li>PBR {preview.pbr ?? '-'}</li>
            <li>ROE {preview.roe.toFixed(1)}%</li>
            <li>3M 모멘텀 {preview.momentum3m >= 0 ? '+' : ''}{preview.momentum3m.toFixed(1)}%</li>
          </ul>
          {preview.risks.length > 0 ? (
            <div className="text-[10px] text-rose-300">DART 리스크: {preview.risks.join(', ')}</div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-300">
              {warnings.map((w, i) => (
                <div key={i}>· {w}</div>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={confirmAdd}
              disabled={isCoreStock(preview.code)}
              className="rounded-md border border-emerald-500 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {isCoreStock(preview.code) ? '이미 핵심 워치리스트' : isDraftStock(preview.code) ? '드래프트 갱신' : '워치리스트에 추가'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BulkAddSection({ onAdded }: { onAdded: () => void }) {
  const [source, setSource] = useState<BulkSource>('magic');
  const [limit, setLimit] = useState<number>(10);
  const [candidates, setCandidates] = useState<BulkCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function loadCandidates() {
    setLoading(true);
    setStatus(null);
    setErrors([]);
    setCandidates([]);
    setSelected(new Set());
    try {
      let list: BulkCandidate[] = [];
      if (source === 'magic') {
        const res = await fetch('/api/screener', { cache: 'no-store' });
        const json = (await res.json()) as { top?: { code: string; name: string; market: string; per: number; roe: number }[]; error?: string };
        if (json.error) throw new Error(json.error);
        list = (json.top ?? []).slice(0, limit).map((s) => ({
          code: s.code,
          name: s.name,
          market: s.market,
          hint: `PER ${s.per?.toFixed?.(1) ?? '-'} / ROE ${s.roe?.toFixed?.(1) ?? '-'}%`,
        }));
      } else {
        const res = await fetch('/api/trending', { cache: 'no-store' });
        const json = (await res.json()) as {
          volume?: { code: string; name: string; market: string; changePct: number }[];
          gainers?: { code: string; name: string; market: string; changePct: number }[];
          foreignBuy?: { code: string; name: string; market: string; amount: number }[];
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        if (source === 'volume') {
          list = (json.volume ?? []).slice(0, limit).map((s) => ({
            code: s.code,
            name: s.name,
            market: s.market,
            hint: `오늘 ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`,
          }));
        } else if (source === 'gainers') {
          list = (json.gainers ?? []).slice(0, limit).map((s) => ({
            code: s.code,
            name: s.name,
            market: s.market,
            hint: `오늘 +${s.changePct.toFixed(2)}%`,
          }));
        } else if (source === 'foreign-buy') {
          list = (json.foreignBuy ?? []).slice(0, limit).map((s) => ({
            code: s.code,
            name: s.name,
            market: s.market,
            hint: `외국인 ${(s.amount / 10000).toFixed(1)}억 매수`,
          }));
        }
      }
      // Filter out core/draft duplicates
      const filtered = list.filter((c) => !isCoreStock(c.code));
      setCandidates(filtered);
      setSelected(new Set(filtered.map((c) => c.code)));
    } catch (e) {
      setStatus(`목록 불러오기 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setLoading(false);
    }
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function confirmBulkAdd() {
    const codes = Array.from(selected);
    if (codes.length === 0) return;
    setAdding(true);
    setStatus(`${codes.length}개 종목 데이터 수집 중… (DART + 네이버, ${Math.ceil(codes.length / 4) * 3}초 정도 소요)`);
    setErrors([]);
    try {
      const res = await fetch(`/api/universe?codes=${codes.join(',')}`, { cache: 'no-store' });
      const json = (await res.json()) as UniverseResponse;
      if (json.error) {
        setStatus(`실패: ${json.error}`);
        return;
      }
      let added = 0;
      const errs: string[] = [];
      for (const r of json.results) {
        if (r.ok) {
          addOrUpdateDraft(r.stock);
          added++;
        } else {
          errs.push(`${r.code}: ${r.error}`);
        }
      }
      setStatus(`${added}개 추가 완료, ${json.failed}개 실패`);
      setErrors(errs);
      onAdded();
      setSelected(new Set());
    } catch (e) {
      setStatus(`실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setAdding(false);
    }
  }

  const sourceLabels: Record<BulkSource, string> = {
    magic: '마법공식',
    volume: '거래량',
    gainers: '급등',
    'foreign-buy': '외국인 매수',
  };

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-sm font-semibold text-slate-200">일괄 추가</div>
      <div className="mt-1 text-[11px] text-slate-400">
        출처와 개수 선택 → 목록에서 원하는 종목만 체크 → 일괄 데이터 수집
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">출처</span>
        {(['magic', 'volume', 'gainers', 'foreign-buy'] as BulkSource[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`rounded-md border px-3 py-1 text-xs transition ${
              source === s
                ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            {sourceLabels[s]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">개수</span>
        {[10, 30, 50].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLimit(n)}
            className={`rounded-md border px-3 py-1 text-xs transition ${
              limit === n
                ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            Top {n}
          </button>
        ))}
        <button
          type="button"
          onClick={loadCandidates}
          disabled={loading}
          className="rounded-md border border-emerald-500 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {loading ? '불러오는 중…' : '목록 불러오기'}
        </button>
      </div>

      {candidates.length > 0 ? (
        <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
            <span className="text-slate-400">
              {candidates.length}개 후보 · {selected.size}개 선택됨 (핵심 워치리스트 종목은 자동 제외)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set(candidates.map((c) => c.code)))}
                className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
              >
                전체 해제
              </button>
            </div>
          </div>
          <ul className="max-h-72 divide-y divide-slate-800/60 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.code} className="flex items-center gap-3 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.has(c.code)}
                  onChange={() => toggle(c.code)}
                  className="h-3 w-3 accent-emerald-400"
                />
                <span className="flex-1 text-slate-100">
                  {c.name}
                  <span className="ml-2 text-[10px] text-slate-500">{c.code} · {c.market}</span>
                </span>
                {c.hint ? <span className="text-[10px] text-slate-400">{c.hint}</span> : null}
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-800 px-3 py-2">
            <button
              type="button"
              onClick={confirmBulkAdd}
              disabled={adding || selected.size === 0}
              className="rounded-md border border-emerald-500 bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {adding ? '추가 중…' : `${selected.size}개 종목 데이터 수집 + 추가`}
            </button>
          </div>
        </div>
      ) : null}

      {status ? (
        <div className="mt-3 rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          {status}
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">
          <div className="font-semibold">실패한 종목:</div>
          {errors.slice(0, 10).map((e, i) => (
            <div key={i}>· {e}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DraftsSection({ drafts, onChanged }: { drafts: StockRaw[]; onChanged: () => void }) {
  if (drafts.length === 0) {
    return (
      <section className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        아직 추가된 드래프트 종목이 없습니다.
      </section>
    );
  }
  return (
    <section className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-sm font-semibold text-slate-200">내가 추가한 종목 ({drafts.length}개)</div>
      <div className="mt-1 text-[11px] text-slate-400">이 브라우저 localStorage에 저장된 드래프트.</div>
      <ul className="mt-3 divide-y divide-slate-800/60">
        {drafts.map((s) => (
          <li key={s.code} className="flex items-center justify-between py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-100">{s.name}</span>
              <span className="text-slate-500">{s.code}</span>
              <span className="text-slate-500">{s.market} · {s.industry}</span>
              <span className="text-slate-400">
                PER {s.per ?? '-'} / ROE {s.roe.toFixed(1)}% / 부채 {s.debtRatio}%
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                removeDraft(s.code);
                onChanged();
              }}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-rose-500 hover:text-rose-300"
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
