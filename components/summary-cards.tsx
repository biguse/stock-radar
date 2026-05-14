import type { StockScored } from '@/types/stock';

type Props = {
  stocks: StockScored[];
};

export function SummaryCards({ stocks }: Props) {
  const total = stocks.length;
  const saCount = stocks.filter((s) => s.grade === 'S' || s.grade === 'A').length;
  const cBelowCount = stocks.filter((s) => s.grade === 'C' || s.grade === 'D' || s.grade === 'X').length;
  const xCount = stocks.filter((s) => s.grade === 'X').length;
  const avgScore =
    total === 0 ? 0 : Math.round(stocks.reduce((sum, s) => sum + s.totalScore, 0) / total);

  const items: { label: string; value: string; tone: string }[] = [
    { label: '전체 종목', value: `${total}`, tone: 'text-slate-200' },
    { label: 'S / A 등급', value: `${saCount}`, tone: 'text-emerald-300' },
    { label: 'C 이하', value: `${cBelowCount}`, tone: 'text-amber-300' },
    { label: 'X 등급', value: `${xCount}`, tone: 'text-rose-300' },
    { label: '평균 종합점수', value: `${avgScore}`, tone: 'text-sky-300' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-sm"
        >
          <div className="text-xs text-slate-400">{item.label}</div>
          <div className={`mt-1 text-2xl font-semibold ${item.tone}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
