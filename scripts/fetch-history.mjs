/**
 * 시장 온도계 — 역사 데이터 수집 (1회성 배치)
 *
 * 출력: data/market-history.json
 *   { builtAt, rows: [{ d, kospi, vix, fx, y10, spread, expYoY }] }
 *
 * 온도 계산은 여기서 하지 않는다. 원시 시계열만 정렬해서 저장하고,
 * 계산은 lib/thermometer.ts 한 곳에서만 한다 (수식 이중 구현 방지).
 *
 * 사용: node scripts/fetch-history.mjs [KOSPI페이지수]
 */
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { writeFileSync, mkdirSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const KOSPI_PAGES = Number(process.argv[2] ?? 900); // 6행/페이지 → 900p ≈ 21년
const CONCURRENCY = 4;
const DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchEucKr(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return iconv.decode(Buffer.from(await res.arrayBuffer()), 'EUC-KR');
}

/** 네이버 일별 지수 한 페이지 → [{d:'YYYY-MM-DD', close:number}] */
function parseIndexPage(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const dateText = $tr.find('td.date').first().text().trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateText)) return;
    const closeText = $tr.find('td.number_1').first().text().trim();
    const close = Number(closeText.replace(/,/g, ''));
    if (!Number.isFinite(close) || close <= 0) return;
    out.push({ d: dateText.replace(/\./g, '-'), close });
  });
  return out;
}

async function fetchKospiHistory(pages) {
  const all = new Map();
  let done = 0;
  for (let start = 1; start <= pages; start += CONCURRENCY) {
    const batch = [];
    for (let p = start; p < start + CONCURRENCY && p <= pages; p++) batch.push(p);
    const results = await Promise.all(
      batch.map(async (p) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const html = await fetchEucKr(
              `https://finance.naver.com/sise/sise_index_day.naver?code=KOSPI&page=${p}`,
            );
            return parseIndexPage(html);
          } catch (e) {
            if (attempt === 2) {
              process.stderr.write(`\n  page ${p} 실패: ${e.message}\n`);
              return [];
            }
            await sleep(500 * (attempt + 1));
          }
        }
        return [];
      }),
    );
    for (const rows of results) for (const r of rows) all.set(r.d, r.close);
    done += batch.length;
    if (done % 60 === 0 || done >= pages) {
      process.stdout.write(`\r  KOSPI ${done}/${pages} 페이지 · ${all.size}일치`);
    }
    await sleep(DELAY_MS);
  }
  process.stdout.write('\n');
  return all;
}

/** FRED CSV (키 불필요) → Map<'YYYY-MM-DD', number> */
async function fetchFred(seriesId) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const csv = await res.text();
  const map = new Map();
  for (const line of csv.split('\n').slice(1)) {
    const [d, v] = line.split(',');
    if (!d || !v) continue;
    const n = Number(v.trim());
    if (!Number.isFinite(n)) continue; // '.' = 결측
    map.set(d.trim(), n);
  }
  return map;
}

/**
 * 직전 유효값으로 채우기.
 * map의 기준일이 dates에 없어도 (월간 데이터, 미국 휴장일 등)
 * "d 이하의 가장 최근 값"을 찾아 쓴다. maxGap일을 넘으면 null.
 */
function forwardFill(map, dates, maxGapDays = 10) {
  const keys = [...map.keys()].sort();
  const out = [];
  let ptr = 0;
  let last = null;
  let lastDate = null;
  for (const d of dates) {
    while (ptr < keys.length && keys[ptr] <= d) {
      lastDate = keys[ptr];
      last = map.get(lastDate);
      ptr++;
    }
    if (last === null || lastDate === null) {
      out.push(null);
      continue;
    }
    const gap = (new Date(d) - new Date(lastDate)) / 86400000;
    out.push(gap <= maxGapDays ? last : null);
  }
  return out;
}

/**
 * 월간 수출 → 전년동월비 %.
 * 관측월 M의 수출은 M+1월 1일에야 발표된다. 관측월 날짜 그대로 쓰면
 * 과거 시점에서 알 수 없던 값을 쓰는 룩어헤드가 된다. 키를 한 달 뒤로 민다.
 */
function toYoY(monthlyMap) {
  const yoy = new Map();
  for (const [d, v] of monthlyMap) {
    const prev = new Date(d);
    prev.setFullYear(prev.getFullYear() - 1);
    const pv = monthlyMap.get(prev.toISOString().slice(0, 10));
    if (!pv || pv <= 0) continue;
    const known = new Date(d); // 발표 지연
    known.setMonth(known.getMonth() + 1);
    yoy.set(known.toISOString().slice(0, 10), Math.round(((v - pv) / pv) * 1000) / 10);
  }
  return yoy;
}

async function main() {
  console.log('시장 온도계 — 역사 데이터 수집\n');

  console.log('[1/3] 네이버 KOSPI 일별 지수');
  const kospi = await fetchKospiHistory(KOSPI_PAGES);

  console.log('[2/3] FRED 시계열');
  const [vix, fx, y10, spread, exports] = await Promise.all([
    fetchFred('VIXCLS'),
    fetchFred('DEXKOUS'),
    fetchFred('DGS10'),
    fetchFred('T10Y2Y'),
    fetchFred('XTEXVA01KRM667S'),
  ]);
  console.log(
    `  VIX ${vix.size} · 환율 ${fx.size} · 10Y ${y10.size} · 스프레드 ${spread.size} · 수출 ${exports.size}`,
  );

  console.log('[3/3] 날짜 정렬 + 결합');
  const dates = [...kospi.keys()].sort();
  const expYoY = toYoY(exports);

  const vixF = forwardFill(vix, dates, 10);
  const fxF = forwardFill(fx, dates, 10);
  const y10F = forwardFill(y10, dates, 10);
  const spreadF = forwardFill(spread, dates, 10);
  const expF = forwardFill(expYoY, dates, 100); // 월간 + 발표 지연

  const rows = dates.map((d, i) => ({
    d,
    kospi: kospi.get(d),
    vix: vixF[i],
    fx: fxF[i],
    y10: y10F[i],
    spread: spreadF[i],
    expYoY: expF[i],
  }));

  // 5축이 모두 존재하는 구간만 유효 (분포 계산 대상)
  const complete = rows.filter(
    (r) => r.vix !== null && r.fx !== null && r.y10 !== null && r.spread !== null && r.expYoY !== null,
  );

  mkdirSync('data', { recursive: true });
  const payload = {
    builtAt: new Date().toISOString().slice(0, 10),
    source: {
      kospi: 'finance.naver.com/sise/sise_index_day.naver',
      fred: ['VIXCLS', 'DEXKOUS', 'DGS10', 'T10Y2Y', 'XTEXVA01KRM667S'],
    },
    rows,
  };
  writeFileSync('data/market-history.json', JSON.stringify(payload));

  console.log('\n완료');
  console.log(`  전체 ${rows.length}일 (${rows[0].d} ~ ${rows[rows.length - 1].d})`);
  console.log(`  5축 완비 ${complete.length}일 (${complete[0]?.d} ~ ${complete[complete.length - 1]?.d})`);
  console.log(`  파일 data/market-history.json`);
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exit(1);
});
