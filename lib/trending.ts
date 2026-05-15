import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import type { Market } from '@/types/stock';

export type TrendingCategory = 'volume' | 'gainers' | 'losers';

export type TrendingStock = {
  rank: number;
  name: string;
  code: string;
  market: Market;
  price: number;
  changePct: number;
  volume: number;
  tradingValue: number | null;
};

type NaverSource = {
  url: string;
  market: Market;
  category: TrendingCategory;
};

const SOURCES: NaverSource[] = [
  { url: 'https://finance.naver.com/sise/sise_quant.naver?sosok=0', market: 'KOSPI', category: 'volume' },
  { url: 'https://finance.naver.com/sise/sise_quant.naver?sosok=1', market: 'KOSDAQ', category: 'volume' },
  { url: 'https://finance.naver.com/sise/sise_rise.naver?sosok=0', market: 'KOSPI', category: 'gainers' },
  { url: 'https://finance.naver.com/sise/sise_rise.naver?sosok=1', market: 'KOSDAQ', category: 'gainers' },
  { url: 'https://finance.naver.com/sise/sise_fall.naver?sosok=0', market: 'KOSPI', category: 'losers' },
  { url: 'https://finance.naver.com/sise/sise_fall.naver?sosok=1', market: 'KOSDAQ', category: 'losers' },
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

function parseNumber(text: string): number {
  const cleaned = text.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  return Number(cleaned);
}

function parseTable(html: string, source: NaverSource): TrendingStock[] {
  const $ = cheerio.load(html);
  const rows: TrendingStock[] = [];

  $('table.type_2 tr').each((_, tr) => {
    const $tr = $(tr);
    const rankText = $tr.find('td.no').first().text().trim();
    if (!rankText) return;
    const rank = parseInt(rankText, 10);
    if (Number.isNaN(rank)) return;

    const link = $tr.find('a.tltle').first();
    const name = link.text().trim();
    const href = link.attr('href') ?? '';
    const codeMatch = href.match(/code=(\d{6})/);
    if (!codeMatch) return;
    const code = codeMatch[1];

    const numberCells = $tr.find('td.number');
    if (numberCells.length < 4) return;

    const price = parseNumber($(numberCells[0]).text());
    const changePctText = $(numberCells[2]).text();
    const isDown = /-/.test(changePctText) || $tr.find('em.bu_pdn').length > 0 || $tr.find('em.bu_pdn2').length > 0;
    const rawPct = parseNumber(changePctText);
    const changePct = isDown && rawPct > 0 ? -rawPct : rawPct;
    const volume = parseNumber($(numberCells[3]).text());

    let tradingValue: number | null = null;
    if (source.category === 'volume' && numberCells.length >= 5) {
      tradingValue = parseNumber($(numberCells[4]).text());
    }

    rows.push({
      rank,
      name,
      code,
      market: source.market,
      price,
      changePct,
      volume,
      tradingValue,
    });
  });

  return rows;
}

export type TrendingResult = {
  fetchedAt: string;
  volume: TrendingStock[];
  gainers: TrendingStock[];
  losers: TrendingStock[];
};

export async function fetchTrending(limit = 25): Promise<TrendingResult> {
  const fetched = await Promise.all(
    SOURCES.map(async (source) => ({
      source,
      stocks: parseTable(await fetchNaver(source.url), source),
    })),
  );

  function mergeAndRank(category: TrendingCategory): TrendingStock[] {
    const all = fetched.filter((f) => f.source.category === category).flatMap((f) => f.stocks);
    if (category === 'volume') {
      all.sort((a, b) => (b.tradingValue ?? b.volume) - (a.tradingValue ?? a.volume));
    } else if (category === 'gainers') {
      all.sort((a, b) => b.changePct - a.changePct);
    } else {
      all.sort((a, b) => a.changePct - b.changePct);
    }
    return all.slice(0, limit).map((s, i) => ({ ...s, rank: i + 1 }));
  }

  return {
    fetchedAt: new Date().toISOString(),
    volume: mergeAndRank('volume'),
    gainers: mergeAndRank('gainers'),
    losers: mergeAndRank('losers'),
  };
}
