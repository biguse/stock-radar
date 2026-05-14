import type { ScoreBreakdown, StockRaw } from '@/types/stock';

export function buildWhyGood(stock: StockRaw, score: ScoreBreakdown, totalScore: number): string[] {
  const reasons: string[] = [];

  if (stock.revenueGrowthRate >= 15 && stock.operatingProfitGrowthRate >= 15) {
    reasons.push(
      `매출 +${stock.revenueGrowthRate.toFixed(1)}%, 영업이익 +${stock.operatingProfitGrowthRate.toFixed(1)}%로 성장이 함께 나오고 있음`,
    );
  } else if (stock.revenueGrowthRate >= 10) {
    reasons.push(`매출이 +${stock.revenueGrowthRate.toFixed(1)}%로 우상향 중`);
  }

  if (stock.netIncome > 0 && stock.roe >= 15) {
    reasons.push(`흑자 + ROE ${stock.roe.toFixed(1)}%로 자본 효율이 높음`);
  } else if (stock.netIncome > 0 && stock.roe >= 10) {
    reasons.push(`흑자 기업이며 ROE ${stock.roe.toFixed(1)}%로 양호`);
  }

  if (stock.operatingCashFlow > 0 && !stock.operatingCashFlowTwoYearsNegative) {
    reasons.push(`영업현금흐름 ${formatBillion(stock.operatingCashFlow)} 흑자로 본업이 돈을 벌고 있음`);
  }

  if (stock.debtRatio <= 80) {
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}%로 재무 안정성이 양호`);
  }

  if (stock.per !== null && stock.per > 0 && stock.per <= 10 && stock.netIncome > 0) {
    reasons.push(`PER ${stock.per.toFixed(1)}배로 밸류에이션이 낮은 편`);
  }

  if (stock.momentum3m >= 15) {
    reasons.push(`최근 3개월 주가 ${stock.momentum3m > 0 ? '+' : ''}${stock.momentum3m.toFixed(1)}%로 모멘텀 발생`);
  }

  if (reasons.length === 0 && totalScore >= 50) {
    reasons.push('큰 약점은 없지만 강한 매수 근거는 부족함');
  }
  if (reasons.length === 0) {
    reasons.push('현재 지표만으로는 적극적으로 올릴 근거가 없음');
  }

  if (score.riskPenalty === 0 && totalScore >= 65) {
    reasons.push('DART 리스크 플래그 없음');
  }

  return reasons;
}

export function buildWhyRisky(stock: StockRaw, forcedExcluded: boolean): string[] {
  const reasons: string[] = [];

  if (stock.risks.includes('관리종목')) {
    reasons.push('관리종목 지정 - 거래 정지/상폐 위험 → 강제 X');
  }
  if (stock.risks.includes('자본잠식 징후')) {
    reasons.push('자본잠식 징후 - 회사 존속 자체가 흔들리는 상태 → 강제 X');
  }
  if (stock.risks.includes('감사의견 위험')) {
    reasons.push('감사의견 비적정 위험 - 재무제표 신뢰도가 떨어짐 (-30점)');
  }
  if (stock.risks.includes('최대주주 변경')) {
    reasons.push('최근 1년 내 최대주주 변경 - 경영권/방향성 불확실 (-15점)');
  }
  if (stock.risks.includes('유상증자')) {
    reasons.push('최근 1년 유상증자 - 기존 주주가치 희석 (-10점)');
  }
  if (stock.risks.includes('전환사채')) {
    reasons.push('최근 1년 전환사채 발행 - 잠재 매도 물량 (-10점)');
  }
  if (stock.risks.includes('영업현금흐름 2년 연속 음수')) {
    reasons.push('영업현금흐름 2년 연속 음수 - 본업으로 돈을 못 벌고 있음 (-20점)');
  } else if (stock.operatingCashFlowTwoYearsNegative) {
    reasons.push('영업현금흐름이 2년 연속 음수');
  }

  if (stock.netIncome <= 0) {
    reasons.push(`당기순손실 ${formatBillion(stock.netIncome)} - 적자 기업`);
  }
  if (stock.debtRatio > 200) {
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}%로 매우 높음`);
  } else if (stock.debtRatio > 150) {
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}%로 부담스러운 수준`);
  }

  if (stock.per !== null && stock.per > 30 && stock.netIncome > 0) {
    reasons.push(`PER ${stock.per.toFixed(1)}배로 가격 부담이 큼`);
  }
  if (stock.momentum3m <= -15) {
    reasons.push(`최근 3개월 주가 ${stock.momentum3m.toFixed(1)}%로 하락 추세`);
  }

  if (reasons.length === 0) {
    reasons.push('현재 표면적인 리스크 플래그는 없음');
  }
  if (forcedExcluded) {
    reasons.push('강제 X 조건에 해당 - 후보군에서 배제');
  }

  return reasons;
}

function formatBillion(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return `${(value / 10000).toFixed(1)}조원`;
  }
  return `${value.toLocaleString('ko-KR')}억원`;
}
