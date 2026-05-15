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
  marketCap: number | null;
};

export type InvestorFlow = {
  rank: number;
  name: string;
  code: string;
  market: Market;
  shares: number;
  amount: number;
  dailyVolume: number;
};

type NaverPriceSource = {
  url: string;
  market: Market;
  category: TrendingCategory;
};

type NaverInvestorSource = {
  url: string;
  market: Market;
  side: 'buy' | 'sell';
  investor: '외국인' | '기관';
};

const PRICE_SOURCES: NaverPriceSource[] = [
  { url: 'https://finance.naver.com/sise/sise_quant.naver?sosok=0', market: 'KOSPI', category: 'volume' },
  { url: 'https://finance.naver.com/sise/sise_quant.naver?sosok=1', market: 'KOSDAQ', category: 'volume' },
  { url: 'https://finance.naver.com/sise/sise_rise.naver?sosok=0', market: 'KOSPI', category: 'gainers' },
  { url: 'https://finance.naver.com/sise/sise_rise.naver?sosok=1', market: 'KOSDAQ', category: 'gainers' },
  { url: 'https://finance.naver.com/sise/sise_fall.naver?sosok=0', market: 'KOSPI', category: 'losers' },
  { url: 'https://finance.naver.com/sise/sise_fall.naver?sosok=1', market: 'KOSDAQ', category: 'losers' },
];

const INVESTOR_SOURCES: NaverInvestorSource[] = [
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=01&investor_gubun=9000&type=buy',
    market: 'KOSPI',
    side: 'buy',
    investor: '외국인',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=02&investor_gubun=9000&type=buy',
    market: 'KOSDAQ',
    side: 'buy',
    investor: '외국인',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=01&investor_gubun=9000&type=sell',
    market: 'KOSPI',
    side: 'sell',
    investor: '외국인',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=02&investor_gubun=9000&type=sell',
    market: 'KOSDAQ',
    side: 'sell',
    investor: '외국인',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=01&investor_gubun=1000&type=buy',
    market: 'KOSPI',
    side: 'buy',
    investor: '기관',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=02&investor_gubun=1000&type=buy',
    market: 'KOSDAQ',
    side: 'buy',
    investor: '기관',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=01&investor_gubun=1000&type=sell',
    market: 'KOSPI',
    side: 'sell',
    investor: '기관',
  },
  {
    url: 'https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=02&investor_gubun=1000&type=sell',
    market: 'KOSDAQ',
    side: 'sell',
    investor: '기관',
  },
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

function assertEnoughRows<T>(rows: T[], label: string): T[] {
  if (rows.length < 5) {
    throw new Error(`Naver parse failed: too few rows for ${label}`);
  }
  return rows;
}

function parseSiseTable(html: string, source: NaverPriceSource): TrendingStock[] {
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
    let marketCap: number | null = null;
    if (source.category === 'volume') {
      if (numberCells.length >= 5) tradingValue = parseNumber($(numberCells[4]).text());
      if (numberCells.length >= 8) marketCap = parseNumber($(numberCells[7]).text());
    }

    rows.push({ rank, name, code, market: source.market, price, changePct, volume, tradingValue, marketCap });
  });

  return rows;
}

function parseInvestorTable(html: string, source: NaverInvestorSource): InvestorFlow[] {
  const $ = cheerio.load(html);
  const rows: InvestorFlow[] = [];
  let rank = 0;

  $('a.tltle').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    const codeMatch = href.match(/code=(\d{6})/);
    if (!codeMatch) return;
    const code = codeMatch[1];
    const name = $a.attr('title') ?? $a.text().trim();

    const $row = $a.closest('tr');
    const numberCells = $row.find('td.number');
    if (numberCells.length < 3) return;

    rank += 1;
    rows.push({
      rank,
      name,
      code,
      market: source.market,
      shares: parseNumber($(numberCells[0]).text()),
      amount: parseNumber($(numberCells[1]).text()),
      dailyVolume: parseNumber($(numberCells[2]).text()),
    });
  });

  return rows;
}

export type TrendingResult = {
  fetchedAt: string;
  volume: TrendingStock[];
  gainers: TrendingStock[];
  losers: TrendingStock[];
  foreignBuy: InvestorFlow[];
  foreignSell: InvestorFlow[];
  institutionBuy: InvestorFlow[];
  institutionSell: InvestorFlow[];
  pumpRisk: TrendingStock[];
};

export async function fetchTrending(limit = 25): Promise<TrendingResult> {
  const [priceFetched, investorFetched] = await Promise.all([
    Promise.all(
      PRICE_SOURCES.map(async (source) => ({
        source,
        stocks: assertEnoughRows(
          parseSiseTable(await fetchNaver(source.url), source),
          `${source.market}-${source.category}`,
        ),
      })),
    ),
    Promise.all(
      INVESTOR_SOURCES.map(async (source) => ({
        source,
        flows: parseInvestorTable(await fetchNaver(source.url), source),
      })),
    ),
  ]);

  function mergePrice(category: TrendingCategory): TrendingStock[] {
    const all = priceFetched.filter((f) => f.source.category === category).flatMap((f) => f.stocks);
    if (category === 'volume') {
      all.sort((a, b) => (b.tradingValue ?? b.volume) - (a.tradingValue ?? a.volume));
    } else if (category === 'gainers') {
      all.sort((a, b) => b.changePct - a.changePct);
    } else {
      all.sort((a, b) => a.changePct - b.changePct);
    }
    return all.slice(0, limit).map((s, i) => ({ ...s, rank: i + 1 }));
  }

  function mergeInvestor(investor: '외국인' | '기관', side: 'buy' | 'sell'): InvestorFlow[] {
    const all = investorFetched
      .filter((f) => f.source.investor === investor && f.source.side === side)
      .flatMap((f) => f.flows);
    const seen = new Set<string>();
    const deduped: InvestorFlow[] = [];
    for (const f of all.sort((a, b) => b.amount - a.amount)) {
      if (seen.has(f.code)) continue;
      seen.add(f.code);
      deduped.push(f);
    }
    return deduped.slice(0, limit).map((f, i) => ({ ...f, rank: i + 1 }));
  }

  const gainersAll = priceFetched.filter((f) => f.source.category === 'gainers').flatMap((f) => f.stocks);
  const volumeAll = priceFetched.filter((f) => f.source.category === 'volume').flatMap((f) => f.stocks);
  const capByCode = new Map<string, number>();
  volumeAll.forEach((s) => {
    if (s.marketCap !== null) capByCode.set(s.code, s.marketCap);
  });

  const seenPump = new Set<string>();
  const pumpRisk: TrendingStock[] = gainersAll
    .filter((s) => {
      if (s.changePct < 15) return false;
      const cap = capByCode.get(s.code);
      if (cap === null || cap === undefined) return false;
      return cap < 1000;
    })
    .sort((a, b) => b.changePct - a.changePct)
    .filter((s) => {
      if (seenPump.has(s.code)) return false;
      seenPump.add(s.code);
      return true;
    })
    .slice(0, 20)
    .map((s, i) => {
      const cap = capByCode.get(s.code) ?? null;
      return { ...s, marketCap: cap, rank: i + 1 };
    });

  return {
    fetchedAt: new Date().toISOString(),
    volume: mergePrice('volume'),
    gainers: mergePrice('gainers'),
    losers: mergePrice('losers'),
    foreignBuy: mergeInvestor('외국인', 'buy'),
    foreignSell: mergeInvestor('외국인', 'sell'),
    institutionBuy: mergeInvestor('기관', 'buy'),
    institutionSell: mergeInvestor('기관', 'sell'),
    pumpRisk,
  };
}
