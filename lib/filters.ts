import type { FilterState, SortKey, StockScored } from '@/types/stock';
import { hasRisk } from '@/lib/riskFlags';

export const DEFAULT_FILTER: FilterState = {
  market: 'ALL',
  grade: 'ALL',
  onlySA: false,
  excludeRisk: false,
  onlyLowPer: false,
  onlyProfitable: false,
  onlyPositiveCashFlow: false,
};

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'custom', label: '내 순서 (편집 가능)' },
  { key: 'totalScore', label: '종합점수 높은 순' },
  { key: 'growth', label: '성장성 높은 순' },
  { key: 'profitability', label: '수익성 높은 순' },
  { key: 'cashFlow', label: '현금흐름 높은 순' },
  { key: 'stability', label: '재무안정성 높은 순' },
  { key: 'valuation', label: '밸류에이션 높은 순' },
  { key: 'momentum', label: '모멘텀 높은 순' },
];

export function applyFilters(stocks: StockScored[], filter: FilterState): StockScored[] {
  return stocks.filter((stock) => {
    if (filter.market !== 'ALL' && stock.market !== filter.market) return false;
    if (filter.grade !== 'ALL' && stock.grade !== filter.grade) return false;
    if (filter.onlySA && stock.grade !== 'S' && stock.grade !== 'A') return false;
    if (filter.excludeRisk && hasRisk(stock)) return false;
    if (filter.onlyLowPer) {
      if (stock.per === null || stock.per <= 0 || stock.per > 12) return false;
    }
    if (filter.onlyProfitable && stock.netIncome <= 0) return false;
    if (filter.onlyPositiveCashFlow && stock.operatingCashFlow <= 0) return false;
    return true;
  });
}

export function applySort(stocks: StockScored[], sortKey: SortKey): StockScored[] {
  if (sortKey === 'custom') {
    // Caller supplies stocks in user-defined order from watchlist-storage
    return [...stocks];
  }
  const sorted = [...stocks];
  if (sortKey === 'totalScore') {
    sorted.sort((a, b) => b.totalScore - a.totalScore);
  } else {
    sorted.sort((a, b) => b.score[sortKey] - a.score[sortKey]);
  }
  return sorted;
}
