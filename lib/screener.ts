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

function parseMarketSum(html: string, market: Market): ScreenerStock[] {
  const $ = cheerio.load(html);
  const rows: ScreenerStock[] = [];

  $('table.type_2 tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a.tltle').first();
    if (link.length === 0) return;
    const name = link.text().trim();
    const href = link.attr('href') ?? '';
    const codeMatch = href.match(/code=(\d{6})/);
    if (!codeMatch) return;
    const code = codeMatch[1];

    const numberCells = $tr.find('td.number');
    if (numberCells.length < 10) return;

    const price = parseInt0($(numberCells[0]).text());
    const changePctText = $(numberCells[2]).text();
    const isDown = /-/.test(changePctText) || $tr.find('em.bu_pdn').length > 0;
    const rawPct = parseInt0(changePctText);
    const changePct = isDown && rawPct > 0 ? -rawPct : rawPct;

    const marketCap = parseInt0($(numberCells[4]).text());
    const foreignRatio = parseRatio($(numberCells[6]).text()) ?? 0;
    const per = parseRatio($(numberCells[8]).text());
    const roe = parseRatio($(numberCells[9]).text());

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
    (s) => !s.isPreferred && s.per !== null && s.per > 0 && s.roe !== null && s.roe > 0,
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
