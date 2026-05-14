'use client';

import { useEffect, useState } from 'react';

type Props = {
  code: string;
  onMemoChange?: (hasMemo: boolean) => void;
};

const STORAGE_PREFIX = 'stock-radar:memo:';

export function MemoBox({ code, onMemoChange }: Props) {
  const [memo, setMemo] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_PREFIX + code) ?? '';
    setMemo(stored);
    if (stored) setSavedAt('저장됨');
    onMemoChange?.(stored.trim().length > 0);
  }, [code, onMemoChange]);

  function handleSave() {
    if (typeof window === 'undefined') return;
    const trimmed = memo.trim();
    if (trimmed.length === 0) {
      window.localStorage.removeItem(STORAGE_PREFIX + code);
      setSavedAt('지움');
      onMemoChange?.(false);
    } else {
      window.localStorage.setItem(STORAGE_PREFIX + code, memo);
      setSavedAt('저장됨');
      onMemoChange?.(true);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">내 판단 메모</div>
        {savedAt ? <div className="text-[10px] text-emerald-400">{savedAt}</div> : null}
      </div>
      <textarea
        value={memo}
        onChange={(e) => {
          setMemo(e.target.value);
          setSavedAt(null);
        }}
        rows={3}
        placeholder="예: 다음 분기 실적 보고 결정, 1주 정도만 사두기, PER 8 밑으로 빠지면 진입 등"
        className="mt-2 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md border border-sky-500 bg-sky-500/20 px-3 py-1 text-xs text-sky-200 hover:bg-sky-500/30"
        >
          저장
        </button>
      </div>
    </div>
  );
}
