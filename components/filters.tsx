'use client';

import type { FilterState, Grade, MarketFilter, SortKey } from '@/types/stock';
import { SORT_OPTIONS } from '@/lib/filters';

type Props = {
  filter: FilterState;
  onFilterChange: (next: FilterState) => void;
  sortKey: SortKey;
  onSortChange: (next: SortKey) => void;
};

const MARKETS: { value: MarketFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'KOSPI', label: 'KOSPI' },
  { value: 'KOSDAQ', label: 'KOSDAQ' },
];

const GRADES: { value: 'ALL' | Grade; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'S', label: 'S' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
  { value: 'X', label: 'X' },
];

export function Filters({ filter, onFilterChange, sortKey, onSortChange }: Props) {
  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    onFilterChange({ ...filter, [key]: value });
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-slate-400">시장</span>
        <div className="flex flex-wrap gap-1">
          {MARKETS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => update('market', m.value)}
              className={`rounded-md border px-3 py-1 text-xs transition ${
                filter.market === m.value
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-slate-400">등급</span>
        <div className="flex flex-wrap gap-1">
          {GRADES.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => update('grade', g.value)}
              className={`rounded-md border px-3 py-1 text-xs transition ${
                filter.grade === g.value
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-slate-400">옵션</span>
        <div className="flex flex-wrap gap-2">
          <Toggle label="S/A만 보기" checked={filter.onlySA} onChange={(v) => update('onlySA', v)} />
          <Toggle
            label="위험 종목 제외"
            checked={filter.excludeRisk}
            onChange={(v) => update('excludeRisk', v)}
          />
          <Toggle
            label="저PER만 (≤12)"
            checked={filter.onlyLowPer}
            onChange={(v) => update('onlyLowPer', v)}
          />
          <Toggle
            label="흑자만"
            checked={filter.onlyProfitable}
            onChange={(v) => update('onlyProfitable', v)}
          />
          <Toggle
            label="OCF 양수만"
            checked={filter.onlyPositiveCashFlow}
            onChange={(v) => update('onlyPositiveCashFlow', v)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-slate-400">정렬</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1 text-xs transition ${
        checked
          ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
          : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500'
      }`}
    >
      <input
        type="checkbox"
        className="h-3 w-3 accent-emerald-400"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
