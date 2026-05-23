import type { StockRaw, StockScored } from '@/types/stock';
import type { StockTiming } from '@/lib/market';

export type LensVerdict = 'pass' | 'neutral' | 'fail';

export type LensResult = {
  key: 'buffett' | 'greenblatt' | 'lynch' | 'marks' | 'own';
  name: string;
  shortName: string;
  verdict: LensVerdict;
  reasons: string[];
  philosophy: string;
};

function fmtIncome(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${(value / 10000).toFixed(1)}조`;
  return `${value.toLocaleString('ko-KR')}억`;
}

export function buffettLens(stock: StockRaw): LensResult {
  const reasons: string[] = [];
  let passed = 0;

  if (stock.roe >= 15) {
    passed++;
    reasons.push(`ROE ${stock.roe.toFixed(1)}% 우량 (≥15%)`);
  } else if (stock.roe >= 10) {
    reasons.push(`ROE ${stock.roe.toFixed(1)}% 양호 (10~15%)`);
  } else {
    reasons.push(`ROE ${stock.roe.toFixed(1)}% 부족 (<10%)`);
  }

  if (stock.debtRatio <= 100) {
    passed++;
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}% 안정 (≤100)`);
  } else if (stock.debtRatio <= 200) {
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}% 보통 (100~200)`);
  } else {
    reasons.push(`부채비율 ${stock.debtRatio.toFixed(0)}% 위험 (>200)`);
  }

  if (stock.netIncome > 0) {
    passed++;
    reasons.push(`흑자 ${fmtIncome(stock.netIncome)}원`);
  } else {
    reasons.push(`적자 ${fmtIncome(stock.netIncome)}원`);
  }

  if (stock.per !== null && stock.per > 0 && stock.per <= 25) {
    passed++;
    reasons.push(`PER ${stock.per.toFixed(1)} 합리적 (≤25)`);
  } else if (stock.per !== null && stock.per > 25 && stock.per <= 40) {
    reasons.push(`PER ${stock.per.toFixed(1)} 부담 (25~40)`);
  } else if (stock.per !== null && stock.per > 40) {
    reasons.push(`PER ${stock.per.toFixed(1)} 비쌈 (>40)`);
  } else {
    reasons.push('PER 미공시 / 무효');
  }

  const verdict: LensVerdict = passed >= 3 ? 'pass' : passed >= 2 ? 'neutral' : 'fail';
  return {
    key: 'buffett',
    name: '워런 버핏',
    shortName: '버핏',
    verdict,
    reasons,
    philosophy: '꾸준히 돈 버는 회사를 부채 없이 적정가에 사기',
  };
}

export function greenblattLens(stock: StockRaw): LensResult {
  const philosophy = '싸면서 좋은 회사 — Earnings Yield(1/PER) + ROE';
  if (stock.netIncome <= 0) {
    return {
      key: 'greenblatt',
      name: '조엘 그린블라트',
      shortName: '그린블',
      verdict: 'fail',
      reasons: ['적자 기업 — 마법공식 대상 아님'],
      philosophy,
    };
  }
  if (stock.per === null || stock.per <= 0) {
    return {
      key: 'greenblatt',
      name: '조엘 그린블라트',
      shortName: '그린블',
      verdict: 'fail',
      reasons: ['PER 무효 — Earnings Yield 계산 불가'],
      philosophy,
    };
  }

  const ey = (1 / stock.per) * 100;
  const reasons: string[] = [];
  let verdict: LensVerdict;

  if (stock.roe >= 15 && stock.per <= 15) {
    verdict = 'pass';
    reasons.push(`PER ${stock.per.toFixed(1)} + ROE ${stock.roe.toFixed(1)}% — 마법공식 통과 영역`);
  } else if (stock.roe >= 10 && stock.per <= 20) {
    verdict = 'neutral';
    reasons.push(`PER ${stock.per.toFixed(1)} + ROE ${stock.roe.toFixed(1)}% — 마법공식 경계 영역`);
  } else {
    verdict = 'fail';
    if (stock.per > 20) reasons.push(`PER ${stock.per.toFixed(1)} 비쌈 (>20)`);
    if (stock.roe < 10) reasons.push(`ROE ${stock.roe.toFixed(1)}% 부족 (<10%)`);
  }
  reasons.push(`Earnings Yield ${ey.toFixed(2)}% (=1/PER)`);

  return {
    key: 'greenblatt',
    name: '조엘 그린블라트',
    shortName: '그린블',
    verdict,
    reasons,
    philosophy,
  };
}

export function lynchLens(stock: StockRaw): LensResult {
  const philosophy = '성장 대비 가격이 싼지 — PEG (PER ÷ 성장률)';
  if (stock.netIncome <= 0 || stock.per === null || stock.per <= 0) {
    return {
      key: 'lynch',
      name: '피터 린치',
      shortName: '린치',
      verdict: 'fail',
      reasons: ['적자 또는 PER 무효 — PEG 계산 불가'],
      philosophy,
    };
  }

  const growth = stock.operatingProfitGrowthRate;
  if (growth <= 0) {
    return {
      key: 'lynch',
      name: '피터 린치',
      shortName: '린치',
      verdict: 'fail',
      reasons: [
        `영업이익 성장 ${growth.toFixed(1)}% — PEG 의미 없음`,
        '린치는 성장하지 않는 회사를 사지 않음',
      ],
      philosophy,
    };
  }

  const peg = stock.per / growth;
  const reasons: string[] = [];
  let verdict: LensVerdict;

  if (peg < 1) {
    verdict = 'pass';
    reasons.push(`PEG ${peg.toFixed(2)} — 성장 대비 저평가 (<1.0)`);
  } else if (peg < 2) {
    verdict = 'neutral';
    reasons.push(`PEG ${peg.toFixed(2)} — 합리적 범위 (1~2)`);
  } else {
    verdict = 'fail';
    reasons.push(`PEG ${peg.toFixed(2)} — 성장 대비 비쌈 (≥2)`);
  }
  reasons.push(`PER ${stock.per.toFixed(1)} / 영업이익 성장 +${growth.toFixed(1)}%`);

  return {
    key: 'lynch',
    name: '피터 린치',
    shortName: '린치',
    verdict,
    reasons,
    philosophy,
  };
}

export function marksLens(stock: StockRaw, timing?: StockTiming): LensResult {
  const philosophy = '남이 두려워할 때 우량주 진입 — 역발상';
  if (!timing) {
    return {
      key: 'marks',
      name: '하워드 마크스',
      shortName: '마크스',
      verdict: 'neutral',
      reasons: ['52주 데이터 로딩 중 — 평가 보류'],
      philosophy,
    };
  }

  const drop = timing.dropFromHighPct;
  const goodFundamental = stock.netIncome > 0 && stock.roe >= 8;
  const reasons: string[] = [`52주 신고가 ${drop.toFixed(1)}%`];
  let verdict: LensVerdict;

  if (drop <= -25 && goodFundamental) {
    verdict = 'pass';
    reasons.push('충분히 조정 받은 우량주 — 역발상 진입 영역');
  } else if (drop <= -15 && goodFundamental) {
    verdict = 'neutral';
    reasons.push('조정 받은 우량주 — 더 빠질 수 있는 점 유의');
  } else if (drop > -10) {
    verdict = 'fail';
    reasons.push('신고가 근접 — 역발상 신호 아님');
  } else {
    verdict = 'fail';
    if (!goodFundamental) reasons.push('펀더멘털 부족 — 떨어지는 칼 위험');
    else reasons.push('낙폭이 애매한 구간');
  }

  return {
    key: 'marks',
    name: '하워드 마크스',
    shortName: '마크스',
    verdict,
    reasons,
    philosophy,
  };
}

export function ownModelLens(scored: StockScored): LensResult {
  const philosophy = '내가 만든 종합 품질 점수 (성장/수익/현금/안정/가치/모멘텀)';
  const reasons: string[] = [`${scored.grade}등급 ${scored.totalScore}점 / 100`];
  let verdict: LensVerdict;

  if (scored.grade === 'S' || scored.grade === 'A') {
    verdict = 'pass';
    reasons.push('본인 모델 합격선 통과');
  } else if (scored.grade === 'B') {
    verdict = 'neutral';
    reasons.push('관찰 영역 — 강한 매수 근거 부족');
  } else {
    verdict = 'fail';
    reasons.push('후보 영역 미달');
  }
  return {
    key: 'own',
    name: '나의 모델',
    shortName: '내 모델',
    verdict,
    reasons,
    philosophy,
  };
}

export function runAllLenses(
  stock: StockRaw,
  scored: StockScored,
  timing?: StockTiming,
): LensResult[] {
  return [
    buffettLens(stock),
    greenblattLens(stock),
    lynchLens(stock),
    marksLens(stock, timing),
    ownModelLens(scored),
  ];
}

export type LensSummary = {
  pass: number;
  neutral: number;
  fail: number;
  overall: '강한 후보' | '후보' | '애매' | '후보 아님';
};

export function summarize(lenses: LensResult[]): LensSummary {
  const pass = lenses.filter((l) => l.verdict === 'pass').length;
  const neutral = lenses.filter((l) => l.verdict === 'neutral').length;
  const fail = lenses.filter((l) => l.verdict === 'fail').length;
  const overall: LensSummary['overall'] =
    pass >= 4 ? '강한 후보' : pass >= 3 ? '후보' : pass >= 2 ? '애매' : '후보 아님';
  return { pass, neutral, fail, overall };
}
