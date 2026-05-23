export type Market = 'KOSPI' | 'KOSDAQ';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'X';
export type ActionSuggestion = '깊게 보기' | '관찰' | '대기' | '피함';
export type RiskFlag =
  | '유상증자'
  | '전환사채'
  | '최대주주 변경'
  | '감사의견 위험'
  | '영업현금흐름 2년 연속 음수'
  | '자본잠식 징후'
  | '관리종목';

export type StockRaw = {
  name: string;
  code: string;
  market: Market;
  industry: string;
  revenueGrowthRate: number;
  operatingProfitGrowthRate: number;
  netIncome: number;
  operatingCashFlow: number;
  operatingCashFlowTwoYearsNegative: boolean;
  per: number | null;
  pbr: number | null;
  roe: number;
  debtRatio: number;
  momentum3m: number;
  risks: RiskFlag[];
};

export type ScoreBreakdown = {
  growth: number;
  profitability: number;
  cashFlow: number;
  stability: number;
  valuation: number;
  momentum: number;
  riskPenalty: number;
};

export type StockScored = StockRaw & {
  totalScore: number;
  grade: Grade;
  action: ActionSuggestion;
  oneLineJudgment: string;
  score: ScoreBreakdown;
  isForcedExcluded: boolean;
  whyGood: string[];
  whyRisky: string[];
};

export type MarketFilter = 'ALL' | Market;
export type GradeFilter = 'ALL' | Grade;

export type FilterState = {
  market: MarketFilter;
  grade: GradeFilter;
  onlySA: boolean;
  excludeRisk: boolean;
  onlyLowPer: boolean;
  onlyProfitable: boolean;
  onlyPositiveCashFlow: boolean;
};

export type SortKey =
  | 'custom'
  | 'totalScore'
  | 'growth'
  | 'profitability'
  | 'cashFlow'
  | 'stability'
  | 'valuation'
  | 'momentum';
