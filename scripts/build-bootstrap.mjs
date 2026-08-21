/**
 * 구간 통계의 블록 부트스트랩 — 사전 계산.
 *
 * 2차 검증 지적:
 *  - 400회는 몬테카를로 오차가 커서 "부호 확정" 판정이 시드에 따라 뒤집힌다
 *  - 블록 길이 252일은 임의 선택이다. 126/504로 바꾸면 결론이 달라진다
 *  - 재표본에서 표본 20개 미만인 구간을 조용히 제외해, 구간마다 유효
 *    반복 수가 달랐다
 *
 * 그래서 10,000회 × 블록 3종을 미리 계산해 data/bootstrap.json에 저장하고,
 * 유효 반복 수도 함께 기록한다. 런타임은 이 파일을 읽기만 한다.
 *
 * 실행: node scripts/build-bootstrap.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MA = 1250;
const WARMUP = 750;
const H = 252;
const REPS = 10000;
const BLOCKS = [126, 252, 504];
const SEED = 20260822;
const BUCKET = 20;
const COUNT = 5;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insertSorted(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  a.splice(lo, 0, v);
}
function pctRank(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return (lo / a.length) * 100;
}
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const rows = JSON.parse(readFileSync('data/market-history.json', 'utf-8')).rows;
const px = rows.map((r) => r.kospi);

// 가격 온도 (운영과 동일한 확장창 백분위)
const dev = [];
let sum = 0;
for (let i = 0; i < px.length; i++) {
  sum += px[i];
  if (i >= MA) sum -= px[i - MA];
  dev.push(i >= MA - 1 ? (px[i] / (sum / MA) - 1) * 100 : null);
}
const sample = [];
const temp = [];
for (const v of dev) {
  if (v === null) { temp.push(null); continue; }
  if (sample.length < WARMUP) { insertSorted(sample, v); temp.push(null); continue; }
  const p = pctRank(sample, v);
  insertSorted(sample, v);
  temp.push(p);
}
const idx = [];
for (let i = 0; i < temp.length; i++) if (temp[i] !== null) idx.push(i);

// (구간, 1년 후 수익률) 쌍
const pairB = new Int8Array(idx.length - H);
const pairR = new Float64Array(idx.length - H);
for (let j = 0; j + H < idx.length; j++) {
  pairB[j] = Math.min(Math.floor(temp[idx[j]] / BUCKET), COUNT - 1);
  pairR[j] = ((px[idx[j + H]] - px[idx[j]]) / px[idx[j]]) * 100;
}
const n = pairB.length;
console.log(`표본 ${n.toLocaleString('ko-KR')}쌍 (${rows[idx[0]].d} ~ ${rows[idx[idx.length - 1 - H]].d})`);

function run(block) {
  const rand = mulberry32(SEED);
  const meds = Array.from({ length: COUNT }, () => []);
  const negs = Array.from({ length: COUNT }, () => []);
  const buf = Array.from({ length: COUNT }, () => new Float64Array(n));
  for (let r = 0; r < REPS; r++) {
    const len = new Int32Array(COUNT);
    let filled = 0;
    while (filled < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < block && filled < n; k++, filled++) {
        const p = (start + k) % n;
        const b = pairB[p];
        buf[b][len[b]++] = pairR[p];
      }
    }
    for (let b = 0; b < COUNT; b++) {
      if (len[b] < 20) continue;
      const g = Array.prototype.slice.call(buf[b].subarray(0, len[b])).sort((x, y) => x - y);
      meds[b].push(quantile(g, 0.5));
      let neg = 0;
      for (let i = 0; i < g.length; i++) if (g[i] < 0) neg++;
      negs[b].push((neg / g.length) * 100);
    }
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  return Array.from({ length: COUNT }, (_, b) => {
    if (meds[b].length < 100) return null;
    meds[b].sort((x, y) => x - y);
    negs[b].sort((x, y) => x - y);
    const lo = quantile(meds[b], 0.025), hi = quantile(meds[b], 0.975);
    return {
      from: b * BUCKET, to: b * BUCKET + BUCKET,
      medianLow: r1(lo), medianHigh: r1(hi),
      negLow: r1(quantile(negs[b], 0.025)), negHigh: r1(quantile(negs[b], 0.975)),
      signCertain: lo > 0 || hi < 0,
      validReps: meds[b].length,
    };
  }).filter(Boolean);
}

const byBlock = {};
for (const block of BLOCKS) {
  const t0 = Date.now();
  byBlock[block] = run(block);
  console.log(`  블록 ${block}일: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  for (const c of byBlock[block]) {
    console.log(`    ${String(c.from).padStart(3)}-${String(c.to).padEnd(3)} 중앙값[${c.medianLow.toFixed(1).padStart(6)},${c.medianHigh.toFixed(1).padStart(6)}] 손실[${c.negLow.toFixed(1).padStart(5)},${c.negHigh.toFixed(1).padStart(5)}] 부호확정=${c.signCertain ? '예' : '아니오'} 유효반복=${c.validReps}`);
  }
}

// 블록 선택에 따라 부호 확정 개수가 몇 개로 갈리는지
const certainCounts = BLOCKS.map((b) => byBlock[b].filter((c) => c.signCertain).length);
const uncertainRange = [COUNT - Math.max(...certainCounts), COUNT - Math.min(...certainCounts)];

writeFileSync('data/bootstrap.json', JSON.stringify({
  builtAt: new Date().toISOString().slice(0, 10),
  reps: REPS, seed: SEED, blocks: BLOCKS, primaryBlock: 252, pairs: n,
  byBlock,
  uncertainRange, // [최소, 최대] 부호 미확정 구간 수
}));
console.log(`\n부호 미확정 구간 수: 블록에 따라 ${uncertainRange[0]}~${uncertainRange[1]}개`);
console.log('data/bootstrap.json 저장');
