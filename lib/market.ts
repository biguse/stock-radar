import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export type IndexCode = 'KOSPI' | 'KOSDAQ';

export type IndexInfo = {
  code: IndexCode;
  value: number;
  changePct: number;
  week52High: number;
  week52Low: number;
  positionPct: number; // 0 = at 52w low, 100 = at 52w high
};

export type StockTiming = {
  code: string;
  current: number;
  week52High: number;
  week52Low: number;
  dropFromHighPct: number; // negative or zero
  riseFromLowPct: number; // positive or zero
  positionPct: number; // 0-100
};

export type MarketPulse = {
  fetchedAt: string;
  indices: IndexInfo[];
  watchlistTiming: Record<string, StockTiming>;
};

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

function parseFloatLoose(text: string): number {
  const cleaned = text.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return Number(cleaned);
}

function computePosition(current: number, low: number, high: number): number {
  if (high <= low) return 50;
  const pct = ((current - low) / (high - low)) * 100;
  if (!Number.isFinite(pct)) return 50;
  return Math.max(0, Math.min(100, pct));
}

function parseIndex(html: string, code: IndexCode): IndexInfo {
  const $ = cheerio.load(html);

  const valueText = $('#now_value').first().text();
  const value = parseFloatLoose(valueText);

  const fluc = $('#change_value_and_rate').first();
  const flucText = fluc.text();
  const pctMatch = flucText.match(/-?\d+\.\d+%/);
  let changePct = pctMatch ? parseFloatLoose(pctMatch[0]) : NaN;
  if (Number.isFinite(changePct) && !flucText.includes('-')) {
    const blind = fluc.find('span.blind').first().text();
    if (blind.includes('하락')) changePct = -Math.abs(changePct);
    else if (blind.includes('상승')) changePct = Math.abs(changePct);
  }

  let week52High = NaN;
  let week52Low = NaN;
  $('th').each((_, th) => {
    const label = $(th).find('span.blind').text().trim();
    if (label === '52주최고' || label === '52주 최고') {
      week52High = parseFloatLoose($(th).next('td').text());
    } else if (label === '52주최저' || label === '52주 최저') {
      week52Low = parseFloatLoose($(th).next('td').text());
    }
  });

  if (!Number.isFinite(value) || !Number.isFinite(week52High) || !Number.isFinite(week52Low)) {
    throw new Error(`Naver index parse failed for ${code}: value=${value} high=${week52High} low=${week52Low}`);
  }

  return {
    code,
    value,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    week52High,
    week52Low,
    positionPct: computePosition(value, week52Low, week52High),
  };
}

function parseStockTiming(html: string, code: string): StockTiming {
  const $ = cheerio.load(html);

  const currentText = $('.no_today .blind').first().text();
  const current = parseFloatLoose(currentText);

  let week52High = NaN;
  let week52Low = NaN;
  $('th.title').each((_, th) => {
    const label = $(th).text().trim();
    const val = $(th).next('td.num').find('span').first().text();
    const num = parseFloatLoose(val);
    if (label === '52주 최고') week52High = num;
    else if (label === '52주 최저') week52Low = num;
  });

  if (!Number.isFinite(current) || !Number.isFinite(week52High) || !Number.isFinite(week52Low)) {
    throw new Error(
      `Naver stock timing parse failed for ${code}: current=${current} high=${week52High} low=${week52Low}`,
    );
  }

  const dropFromHighPct = week52High > 0 ? ((current - week52High) / week52High) * 100 : 0;
  const riseFromLowPct = week52Low > 0 ? ((current - week52Low) / week52Low) * 100 : 0;

  return {
    code,
    current,
    week52High,
    week52Low,
    dropFromHighPct,
    riseFromLowPct,
    positionPct: computePosition(current, week52Low, week52High),
  };
}

export async function fetchMarketPulse(watchlistCodes: string[]): Promise<MarketPulse> {
  const indexUrls: { code: IndexCode; url: string }[] = [
    { code: 'KOSPI', url: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI' },
    { code: 'KOSDAQ', url: 'https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ' },
  ];

  const indicesPromise = Promise.all(
    indexUrls.map(async ({ code, url }) => parseIndex(await fetchNaver(url), code)),
  );

  const timingsPromise = Promise.all(
    watchlistCodes.map(async (code) => {
      const html = await fetchNaver(`https://finance.naver.com/item/sise.naver?code=${code}`);
      return parseStockTiming(html, code);
    }),
  );

  const [indices, timings] = await Promise.all([indicesPromise, timingsPromise]);

  const watchlistTiming: Record<string, StockTiming> = {};
  for (const t of timings) watchlistTiming[t.code] = t;

  return {
    fetchedAt: new Date().toISOString(),
    indices,
    watchlistTiming,
  };
}
