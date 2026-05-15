import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import type { Market } from '@/types/stock';

export type ScreenerStock = {
  rank: number;
  name: string;
  code: string;
  market: Market;
  price: number;
  changePct: number;
  marketCap: number; // 억원
  foreignRatio: number; // %
  per: number | null;
  roe: number | null;
  earningsYield: number | null; // 1/PER * 100, higher = cheaper
  earningsYieldRank: number | null;
  roeRank: number | null;
  magicScore: number | null; // lower = better
  isPreferred: boolean;
};

const PAGES_PER_MARKET = 4; // 50 rows per page * 4 = up to 200 per market
const MARKETS: { market: Market; sosok: '0' | '1' }[] = [
  { market: 'KOSPI', sosok: '0' },
  { market: 'KOSDAQ', sosok: '1' },
];

const MIN_MARKET_CAP = 1000; // 억원
const MIN_PER = 1;
const MAX_ROE = 80;

async function fetchNaver(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Naver fetch failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, 'EUC-KR');
}

function parseRatio(text: string): number | null {
  const cleaned = text.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

function parseInt0(text: string): number {
  const cleaned = text.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  return Number(cleaned);
}

function isPreferredShare(name: string): boolean {
  return /우$|우B$|우C$|\(우\)/.test(name) || name.includes('우선주');
}

function isFundLike(name: string): boolean {
  return /^(KODEX|TIGER|KOSEF|PLUS|ARIRANG|HANARO|SOL|RISE|KIWOOM|TIMEFOLIO|ACE|KBSTAR|HK|SOL|ETN)/.test(
    name,
  );
}

type ColumnMap = {
  현재가?: number;
  등락률?: number;
  시가총액?: number;
  외국인비율?: number;
  PER?: number;
  ROE?: number;
};

function buildColumnMap($: cheerio.CheerioAPI): ColumnMap {
  const map: ColumnMap = {};
  $('table.type_2 thead th').each((i, th) => {
    const text = $(th).text().trim();
    if (text === '현재가') map.현재가 = i;
    else if (text === '등락률') map.등락률 = i;
    else if (text === '시가총액') map.시가총액 = i;
    else if (text === '외국인비율') map.외국인비율 = i;
    else if (text === 'PER') map.PER = i;
    else if (text === 'ROE') map.ROE = i;
  });
  return map;
}

function parseMarketSum(html: string, market: Market): ScreenerStock[] {
  const $ = cheerio.load(html);
  const cols = buildColumnMap($);

  if (
    cols.현재가 === undefined ||
    cols.등락률 === undefined ||
    cols.시가총액 === undefined ||
    cols.외국인비율 === undefined ||
    cols.PER === undefined ||
    cols.ROE === undefined
  ) {
    throw new Error(
      `Naver market_sum header mismatch: ${JSON.stringify(cols)} (expected 현재가, 등락률, 시가총액, 외국인비율, PER, ROE)`,
    );
  }

  const rows: ScreenerStock[] = [];

  $('table.type_2 tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a.tltle').first();
    if (link.length === 0) return;
    const name = link.text().trim();
    const href = link.attr('href') ?? '';
    const codeMatch = href.match(/code=(\d{6})/);
    if (!codeMatch) return;
    const code = codeMatch[1];

    const cells = $tr.children('td').toArray();
    if (cells.length <= (cols.ROE ?? 0)) return;

    const cellText = (idx?: number): string => (idx === undefined ? '' : $(cells[idx]).text());

    const price = parseInt0(cellText(cols.현재가));
    const changeText = cellText(cols.등락률);
    const isDown = changeText.includes('-') || $tr.find('em.bu_pdn').length > 0;
    const rawPct = parseInt0(changeText);
    const changePct = isDown && rawPct > 0 ? -rawPct : rawPct;

    const marketCap = parseInt0(cellText(cols.시가총액));
    const foreignRatio = parseRatio(cellText(cols.외국인비율)) ?? 0;
    const per = parseRatio(cellText(cols.PER));
    const roe = parseRatio(cellText(cols.ROE));

    rows.push({
      rank: 0,
      name,
      code,
      market,
      price,
      changePct,
      marketCap,
      foreignRatio,
      per,
      roe,
      earningsYield: null,
      earningsYieldRank: null,
      roeRank: null,
      magicScore: null,
      isPreferred: isPreferredShare(name) || isFundLike(name),
    });
  });

  const perRoeValidCount = rows.filter((s) => s.per !== null && s.roe !== null).length;
  if (rows.length >= 20 && perRoeValidCount / rows.length < 0.3) {
    throw new Error('Naver market_sum parse suspicious: PER/ROE valid ratio too low');
  }

  return rows;
}

export type ScreenerResult = {
  fetchedAt: string;
  universeSize: number;
  eligible: number;
  excluded: number;
  top: ScreenerStock[];
};

export async function fetchScreener(topN = 30): Promise<ScreenerResult> {
  const urls: { url: string; market: Market }[] = [];
  for (const { market, sosok } of MARKETS) {
    for (let page = 1; page <= PAGES_PER_MARKET; page++) {
      urls.push({
        url: `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`,
        market,
      });
    }
  }

  const fetched = await Promise.all(
    urls.map(async ({ url, market }) => parseMarketSum(await fetchNaver(url), market)),
  );

  const allRaw = fetched.flat();
  const seen = new Set<string>();
  const universe: ScreenerStock[] = [];
  for (const s of allRaw) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    universe.push(s);
  }

  if (universe.length < 100) {
    throw new Error(`Naver market_sum parse failed: only ${universe.length} rows`);
  }

  const eligible = universe.filter(
    (s) =>
      !s.isPreferred &&
      s.marketCap >= MIN_MARKET_CAP &&
      s.per !== null &&
      s.per >= MIN_PER &&
      s.roe !== null &&
      s.roe > 0 &&
      s.roe <= MAX_ROE,
  );

  eligible.forEach((s) => {
    s.earningsYield = s.per && s.per > 0 ? (1 / s.per) * 100 : null;
  });

  const byEY = [...eligible].sort((a, b) => (b.earningsYield ?? 0) - (a.earningsYield ?? 0));
  byEY.forEach((s, i) => {
    s.earningsYieldRank = i + 1;
  });

  const byROE = [...eligible].sort((a, b) => (b.roe ?? 0) - (a.roe ?? 0));
  byROE.forEach((s, i) => {
    s.roeRank = i + 1;
  });

  eligible.forEach((s) => {
    if (s.earningsYieldRank !== null && s.roeRank !== null) {
      s.magicScore = s.earningsYieldRank + s.roeRank;
    }
  });

  const top = [...eligible]
    .filter((s) => s.magicScore !== null)
    .sort((a, b) => (a.magicScore ?? Infinity) - (b.magicScore ?? Infinity))
    .slice(0, topN)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  return {
    fetchedAt: new Date().toISOString(),
    universeSize: universe.length,
    eligible: eligible.length,
    excluded: universe.length - eligible.length,
    top,
  };
}
