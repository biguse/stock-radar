import type { RiskFlag, StockRaw } from '@/types/stock';

const PENALTY_BY_RISK: Record<RiskFlag, number> = {
  유상증자: 10,
  전환사채: 10,
  '최대주주 변경': 15,
  '감사의견 위험': 30,
  '영업현금흐름 2년 연속 음수': 20,
  '자본잠식 징후': 0,
  관리종목: 0,
};

const FORCED_EXCLUDE_RISKS: RiskFlag[] = ['자본잠식 징후', '관리종목'];

export function getRiskPenalty(stock: StockRaw): number {
  const flagPenalty = stock.risks.reduce((sum, risk) => sum + PENALTY_BY_RISK[risk], 0);
  const hasNegativeCashFlowFlag = stock.risks.includes('영업현금흐름 2년 연속 음수');
  const inferredCashFlowPenalty =
    !hasNegativeCashFlowFlag && stock.operatingCashFlowTwoYearsNegative ? 20 : 0;
  return Math.min(100, flagPenalty + inferredCashFlowPenalty);
}

export function isForcedExcluded(stock: StockRaw): boolean {
  return stock.risks.some((risk) => FORCED_EXCLUDE_RISKS.includes(risk));
}

export function hasRisk(stock: StockRaw): boolean {
  return stock.risks.length > 0 || stock.operatingCashFlowTwoYearsNegative;
}
