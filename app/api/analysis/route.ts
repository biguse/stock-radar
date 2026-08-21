import { NextResponse } from 'next/server';
import historyData from '@/data/market-history.json';
import { computeTemperatureSeries, type MarketRow, type DayTemperature } from '@/lib/thermometer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const d = Math.sqrt(dx * dy);
  return d === 0 ? 0 : Math.round((num / d) * 1000) / 1000;
}

function test(series: DayTemperature[], horizon: number, pick: (t: DayTemperature) => number) {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i + horizon < series.length; i += horizon) {
    xs.push(pick(series[i]));
    ys.push(((series[i + horizon].kospi - series[i].kospi) / series[i].kospi) * 100);
  }
  return { correlation: corr(xs, ys), n: xs.length };
}

export async function GET() {
  const rows = (historyData as { rows: MarketRow[] }).rows;
  const series = computeTemperatureSeries(rows);
  const composite = (t: DayTemperature) => t.temp;
  const priceOnly = (t: DayTemperature) => t.axes.find((a) => a.key === 'price')?.score ?? 50;
  const fearOnly = (t: DayTemperature) => t.axes.find((a) => a.key === 'fear')?.score ?? 50;

  return NextResponse.json({
    coverage: { from: series[0]?.d, to: series[series.length - 1]?.d, days: series.length },
    byHorizon: [
      { label: '1년', d: 252 }, { label: '2년', d: 504 },
      { label: '3년', d: 756 }, { label: '5년', d: 1260 },
    ].map((h) => ({
      horizon: h.label,
      composite: test(series, h.d, composite),
      priceOnly: test(series, h.d, priceOnly),
      fearOnly: test(series, h.d, fearOnly),
    })),
  });
}
