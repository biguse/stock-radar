/**
 * 손익분기 승률 — 비용을 넣으면 몇 %를 맞혀야 본전인가.
 *
 * 르네상스 메달리온의 승률은 약 50.75%로 알려져 있다. 세계 최고
 * 수익률을 낸 펀드가 개별 베팅으로는 거의 동전이다. 그런데도 이기는
 * 이유는 예측력이 아니라 (1) 하루 수십만 번의 반복과 (2) 마켓메이커
 * 지위에서 오는 사실상 0에 가까운 거래비용이다.
 *
 * 개인은 같은 승률로도 진다. 비용 구조가 다르기 때문이다.
 * 이 파일은 그 격차를 숫자로 계산한다.
 */

/**
 * 왕복 거래비용 (비율).
 * 2026-01-01 시행으로 코스피 증권거래세가 0%→0.05%로 인상됐고 농어촌특별세
 * 0.15%가 별도이므로 세금 합계는 0.20%다. (이전 코드는 0.15%로 잘못 잡았다)
 */
export const COST = {
  /** 개별주식: 세금 0.20%(매도) + 위탁수수료 왕복 0.03% + 슬리피지 0.05% */
  stock: 0.0020 + 0.0003 + 0.0005,
  /** 국내 주식형 ETF: 증권거래세 면제. 수수료 + 호가 스프레드만 */
  etf: 0.0003 + 0.0005,
} as const;

export type HoldingStat = {
  days: number;
  label: string;
  n: number;
  /** 실제로 오른 비율 */
  winRate: number;
  /** 오른 날의 평균 상승폭 (%) */
  avgGain: number;
  /** 내린 날의 평균 하락폭 (%, 양수) */
  avgLoss: number;
  /** 본전을 맞추는 데 필요한 승률 (%) — 개별주식 */
  breakEvenStock: number;
  /** 본전을 맞추는 데 필요한 승률 (%) — ETF */
  breakEvenEtf: number;
  /** 실제 승률 − 필요 승률 (%p, 개별주식 기준). 음수면 구조적으로 진다 */
  edgeStock: number;
  /** 1년간 이 주기로 매매할 때 나가는 비용 (거래대금 단순합, 원금 대비 %) — 개별주식 */
  annualCostStock: number;
  annualCostEtf: number;
  /** 남은 자본에 매번 비용을 물릴 때의 실제 자본 감소율 (%) — 복리 */
  annualDrawdownStock: number;
};

const PERIODS: { days: number; label: string }[] = [
  { days: 1, label: '하루' },
  { days: 5, label: '일주일' },
  { days: 20, label: '한 달' },
  { days: 60, label: '세 달' },
  { days: 252, label: '일 년' },
];

export function holdingStats(prices: number[]): HoldingStat[] {
  return PERIODS.map(({ days, label }) => {
    const rets: number[] = [];
    for (let i = 0; i + days < prices.length; i++) rets.push(prices[i + days] / prices[i] - 1);
    const up = rets.filter((r) => r > 0);
    const dn = rets.filter((r) => r <= 0);
    const avgGain = up.reduce((s, x) => s + x, 0) / (up.length || 1);
    const avgLoss = -dn.reduce((s, x) => s + x, 0) / (dn.length || 1);
    const winRate = up.length / rets.length;

    // p × 평균상승 − (1−p) × 평균하락 − 비용 = 0  →  p = (평균하락 + 비용) / (평균상승 + 평균하락)
    const be = (cost: number) => ((avgLoss + cost) / (avgGain + avgLoss)) * 100;
    const trips = 252 / days;

    return {
      days,
      label,
      n: rets.length,
      winRate: Math.round(winRate * 1000) / 10,
      avgGain: Math.round(avgGain * 10000) / 100,
      avgLoss: Math.round(avgLoss * 10000) / 100,
      breakEvenStock: Math.round(be(COST.stock) * 10) / 10,
      breakEvenEtf: Math.round(be(COST.etf) * 10) / 10,
      edgeStock: Math.round((winRate * 100 - be(COST.stock)) * 10) / 10,
      annualCostStock: Math.round(trips * COST.stock * 1000) / 10,
      annualCostEtf: Math.round(trips * COST.etf * 1000) / 10,
      annualDrawdownStock: Math.round((1 - Math.pow(1 - COST.stock, trips)) * 1000) / 10,
    };
  });
}

/** 메달리온 펀드의 알려진 승률 (저커먼, The Man Who Solved the Market) */
export const MEDALLION_WIN_RATE = 50.75;

/**
 * 손익분기 승률은 '손익 크기'에 따라 크게 달라진다.
 * holdingStats는 코스피의 상승일·하락일 평균 크기를 그대로 쓰지만,
 * 손절·익절로 그 비율을 바꾸면 필요 승률도 바뀐다.
 * 따라서 "매일 매매하면 61%가 필요하다"는 일반 명제가 아니라
 * "시장 평균과 같은 손익 크기를 갖는 전략"에만 해당한다.
 */
export function payoffSensitivity(cost = COST.stock) {
  const cases: { gain: number; loss: number; label: string }[] = [
    { gain: 1.07, loss: 1.09, label: '시장 평균과 같을 때' },
    { gain: 2.0, loss: 1.0, label: '이익을 2배로 키울 때' },
    { gain: 3.0, loss: 1.0, label: '이익을 3배로 키울 때' },
    { gain: 1.0, loss: 2.0, label: '손실을 2배로 키울 때' },
  ];
  return cases.map((c) => ({
    ...c,
    breakEven: Math.round(((c.loss / 100 + cost) / (c.gain / 100 + c.loss / 100)) * 1000) / 10,
  }));
}
