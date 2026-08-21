/**
 * 매일 1줄 기록 — data/market-history.json 증분 갱신
 *
 * 온도는 여기서 계산하지 않는다. 원시 데이터만 쌓는다.
 * 온도 계산이 lookahead-free(각 시점은 그 시점까지의 표본만 사용)이므로,
 * 과거 어느 날의 온도든 나중에 다시 계산해도 값이 같다.
 * → 별도 예측 기록부가 필요 없고, 누구나 재현·검증할 수 있다.
 */
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const FILE = 'data/market-history.json';
const VALUATION_FILE = 'data/krx-valuation.json';

async function recentKospi() {
  const res = await fetch('https://finance.naver.com/sise/sise_index_day.naver?code=KOSPI&page=1', {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`네이버 HTTP ${res.status}`);
  const html = iconv.decode(Buffer.from(await res.arrayBuffer()), 'EUC-KR');
  const $ = cheerio.load(html);
  const out = new Map();
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const d = $tr.find('td.date').first().text().trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(d)) return;
    const close = Number($tr.find('td.number_1').first().text().trim().replace(/,/g, ''));
    if (Number.isFinite(close) && close > 0) out.set(d.replace(/\./g, '-'), close);
  });
  return out;
}

async function fredRecent(id, days = 200) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`);
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
  const map = new Map();
  for (const line of (await res.text()).split('\n').slice(1)) {
    const [d, v] = line.split(',');
    if (!d || !v) continue;
    const n = Number(v.trim());
    if (Number.isFinite(n)) map.set(d.trim(), n);
  }
  return map;
}

/** d 이하의 가장 최근 값 */
function asOf(map, d, maxGapDays) {
  let best = null;
  let bestDate = null;
  for (const [k, v] of map) {
    if (k <= d && (bestDate === null || k > bestDate)) {
      bestDate = k;
      best = v;
    }
  }
  if (best === null) return null;
  const gap = (new Date(d) - new Date(bestDate)) / 86400000;
  return gap <= maxGapDays ? best : null;
}

async function main() {
  const payload = JSON.parse(readFileSync(FILE, 'utf-8'));
  const known = new Set(payload.rows.map((r) => r.d));
  const lastDate = payload.rows[payload.rows.length - 1].d;

  const [kospi, vix, fx, y10, spread, exports, kr10y] = await Promise.all([
    recentKospi(),
    fredRecent('VIXCLS'),
    fredRecent('DEXKOUS'),
    fredRecent('DGS10'),
    fredRecent('T10Y2Y'),
    fredRecent('XTEXVA01KRM667S', 800),
    fredRecent('INTGSBKRM193N', 800), // 한국 국고채 장기금리 (월간)
  ]);

  // 수출 전년동월비
  // 관측월 M의 수출은 M+1월 1일에야 발표된다 (룩어헤드 방지)
  const expYoY = new Map();
  for (const [d, v] of exports) {
    const prev = new Date(d);
    prev.setFullYear(prev.getFullYear() - 1);
    const pv = exports.get(prev.toISOString().slice(0, 10));
    if (!pv || pv <= 0) continue;
    const known = new Date(d);
    known.setMonth(known.getMonth() + 1);
    expYoY.set(known.toISOString().slice(0, 10), Math.round(((v - pv) / pv) * 1000) / 10);
  }

  const added = [];
  for (const [d, close] of [...kospi.entries()].sort()) {
    if (known.has(d) || d <= lastDate) continue;
    added.push({
      d,
      kospi: close,
      vix: asOf(vix, d, 10),
      fx: asOf(fx, d, 10),
      y10: asOf(y10, d, 10),
      spread: asOf(spread, d, 10),
      expYoY: asOf(expYoY, d, 100),
      kr10y: asOf(kr10y, d, 100),
      per: null,
      pbr: null,
    });
  }

  payload.rows.push(...added);
  payload.rows.sort((a, b) => a.d.localeCompare(b.d));

  // KRX 밸류에이션(PER/PBR) 병합 — 파이썬 스크립트가 먼저 갱신해 둔 파일을 읽는다
  let merged = 0;
  if (existsSync(VALUATION_FILE)) {
    const val = JSON.parse(readFileSync(VALUATION_FILE, 'utf-8'));
    for (const r of payload.rows) {
      const v = val[r.d];
      if (!v) continue;
      const nextPer = v.per ?? null;
      const nextPbr = v.pbr ?? null;
      if (r.per !== nextPer || r.pbr !== nextPbr) merged++;
      r.per = nextPer;
      r.pbr = nextPbr;
    }
  }

  if (added.length === 0 && merged === 0) {
    console.log(`변경 없음 (마지막 거래일 ${lastDate})`);
    return;
  }
  payload.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(FILE, JSON.stringify(payload));

  console.log(`신규 ${added.length}일 · PER/PBR 갱신 ${merged}건`);
  for (const r of added) {
    console.log(`  ${r.d} KOSPI ${r.kospi.toLocaleString()} VIX ${r.vix} 환율 ${r.fx} PER ${r.per ?? '-'} PBR ${r.pbr ?? '-'}`);
  }
  console.log(`총 ${payload.rows.length}일 (${payload.rows[0].d} ~ ${payload.rows[payload.rows.length - 1].d})`);
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
