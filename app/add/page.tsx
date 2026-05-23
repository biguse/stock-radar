'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function AddPage() {
  const [drafts, setDrafts] = useState<StockRaw[]>([]);
  useEffect(() => {
    setDrafts(getDraftWatchlist());
  }, []);
  const refreshDrafts = () => setDrafts(getDraftWatchlist());

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">종목 추가</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          종목코드 6자리를 입력하면 DART + 네이버에서 자동으로 데이터를 수집해 워치리스트에 추가합니다.
        </p>
      </header>

      <SingleAddSection onAdded={refreshDrafts} />

      <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-xs text-slate-400">
        <strong className="text-slate-200">💡 일괄 발굴은 거장의 눈에서</strong>
        <div className="mt-1 leading-relaxed">
          거래량 / 시총 / 급등 / 외국인매수 / 마법공식 상위 종목을 한 번에 거장 5명 렌즈로 평가하려면{' '}
          <a href="/genius" className="text-sky-300 underline">
            거장의 눈
          </a>{' '}
          → 분석 대상 토글에서 원하는 출처 선택. 결과에서 마음에 드는 종목만 + 워치리스트 클릭.
        </div>
      </div>

      <DraftsSection drafts={drafts} onChanged={refreshDrafts} />

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">⚠️ 사용 시 주의</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>드래프트 워치리스트는 <strong>이 브라우저 localStorage</strong>에 저장됩니다. 다른 기기에선 안 보입니다.</li>
          <li>핵심 워치리스트(코드에 박힌 7개)는 이 페이지에서 삭제할 수 없습니다.</li>
          <li>DART API 키가 설정 안 되어 있으면 자동 데이터 수집이 실패합니다. README의 DART 설정 참고.</li>
          <li>가져온 데이터 일부 항목은 0이거나 누락될 수 있습니다. 점수가 이상하면 종목코드로 직접 확인.</li>
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
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          placeholder="종목코드 6자리 (예: 005930)"
          className="flex-1 min-w-[150px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={fetchPreview}
          disabled={loading}
          className="rounded-md border border-sky-500 bg-sky-500/20 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
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
              className="rounded-md border border-emerald-500 bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {isCoreStock(preview.code)
                ? '이미 핵심 워치리스트'
                : isDraftStock(preview.code)
                ? '드래프트 갱신'
                : '워치리스트에 추가'}
            </button>
          </div>
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
              <span className="text-slate-500">
                {s.market} · {s.industry}
              </span>
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
