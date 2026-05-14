import type { ActionSuggestion, Grade, ScoreBreakdown, StockRaw, StockScored } from '@/types/stock';
import { getRiskPenalty, isForcedExcluded } from '@/lib/riskFlags';

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function scoreGrowth(stock: StockRaw): number {
  const revenueScore = clamp(stock.revenueGrowthRate * 1.2, 0, 12);
  const profitScore = clamp(stock.operatingProfitGrowthRate * 0.9, 0, 13);
  return revenueScore + profitScore;
}

function scoreProfitability(stock: StockRaw): number {
  if (stock.netIncome <= 0) return 0;
  if (stock.roe >= 20) return 20;
  if (stock.roe >= 15) return 17;
  if (stock.roe >= 10) return 14;
  if (stock.roe >= 7) return 10;
  if (stock.roe >= 3) return 6;
  return 3;
}

function scoreCashFlow(stock: StockRaw): number {
  if (stock.operatingCashFlowTwoYearsNegative) return 0;
  if (stock.operatingCashFlow > 5000) return 20;
  if (stock.operatingCashFlow > 1000) return 17;
  if (stock.operatingCashFlow > 0) return 13;
  return 3;
}

function scoreStability(stock: StockRaw): number {
  if (stock.debtRatio <= 50) return 15;
  if (stock.debtRatio <= 100) return 13;
  if (stock.debtRatio <= 150) return 10;
  if (stock.debtRatio <= 200) return 6;
  return 2;
}

function scoreValuation(stock: StockRaw): number {
  const per = stock.per;
  const pbr = stock.pbr;
  if (per === null || pbr === null || stock.netIncome <= 0) return 1;
  let score = 0;
  if (per <= 8) score += 6;
  else if (per <= 12) score += 5;
  else if (per <= 18) score += 3;
  else if (per <= 25) score += 2;
  else score += 0;

  if (pbr <= 0.8) score += 4;
  else if (pbr <= 1.3) score += 3;
  else if (pbr <= 2) score += 2;
  else score += 0;
  return clamp(score, 0, 10);
}

function scoreMomentum(stock: StockRaw): number {
  if (stock.momentum3m >= 25) return 10;
  if (stock.momentum3m >= 15) return 8;
  if (stock.momentum3m >= 5) return 6;
  if (stock.momentum3m >= -5) return 4;
  if (stock.momentum3m >= -15) return 2;
  return 0;
}

function getGrade(score: number, forcedExcluded: boolean): Grade {
  if (forcedExcluded) return 'X';
  if (score >= 85) return 'S';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'X';
}

function getAction(grade: Grade): ActionSuggestion {
  if (grade === 'S') return '깊게 보기';
  if (grade === 'A' || grade === 'B') return '관찰';
  if (grade === 'C') return '대기';
  return '피함';
}

function getJudgment(stock: StockRaw, grade: Grade): string {
  if (grade === 'S') return '실적, 현금흐름, 재무 안정성이 함께 양호해 당장 깊게 볼 만한 후보입니다.';
  if (grade === 'A') return '매수 후보로 검토할 수 있지만 가격과 리스크를 한 번 더 확인해야 합니다.';
  if (grade === 'B') return '관찰할 만하지만 강한 매수 근거는 아직 부족합니다.';
  if (grade === 'C') return '애매한 구간입니다. 실적 확인이나 가격 조정이 더 필요합니다.';
  if (stock.risks.length > 0) return 'DART 리스크가 있어 지금은 피하는 쪽이 안전합니다.';
  return '점수와 조건이 부족해 건드리지 않는 쪽이 낫습니다.';
}

export function scoreStock(stock: StockRaw): StockScored {
  const score: ScoreBreakdown = {
    growth: scoreGrowth(stock),
    profitability: scoreProfitability(stock),
    cashFlow: scoreCashFlow(stock),
    stability: scoreStability(stock),
    valuation: scoreValuation(stock),
    momentum: scoreMomentum(stock),
    riskPenalty: getRiskPenalty(stock),
  };
  const forcedExcluded = isForcedExcluded(stock);
  const subtotal = score.growth + score.profitability + score.cashFlow + score.stability + score.valuation + score.momentum;
  const totalScore = forcedExcluded ? 0 : clamp(subtotal - score.riskPenalty, 0, 100);
  const grade = getGrade(totalScore, forcedExcluded);
  return {
    ...stock,
    score,
    totalScore,
    grade,
    action: getAction(grade),
    oneLineJudgment: getJudgment(stock, grade),
    isForcedExcluded: forcedExcluded,
  };
}

export function scoreStocks(stocks: StockRaw[]): StockScored[] {
  return stocks.map(scoreStock);
}
