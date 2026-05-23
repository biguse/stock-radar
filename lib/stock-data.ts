import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import type { Market, RiskFlag, StockRaw } from '@/types/stock';
import { fetchDartFinancials, fetchDartRiskFlags } from '@/lib/dart';

async function fetchNaver(url: string, encoding: 'utf8' | 'euckr' = 'euckr'): Promise<string> {
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
  return encoding === 'utf8' ? buf.toString('utf-8') : iconv.decode(buf, 'EUC-KR');
}

function parseFloatLoose(text: string): number | null {
  const cleaned = text.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

type NaverItemMain = {
  name: string;
  market: Market | null;
  industry: string;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  current: number | null;
};

function parseItemMain(html: string): NaverItemMain {
  const $ = cheerio.load(html);

  const name = $('.wrap_company h2 a').first().text().trim() ||
    $('div.wrap_company h2').first().text().trim();

  let market: Market | null = null;
  const description = $('.wrap_company .description').first().text();
  if (description.includes('코스피') || description.includes('KOSPI')) market = 'KOSPI';
  else if (description.includes('코스닥') || description.includes('KOSDAQ')) market = 'KOSDAQ';

  let industry = '';
  $('a').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (href.includes('sise_group_detail.naver') && href.includes('type=upjong')) {
      industry = $(a).text().trim();
      return false;
    }
  });

  // PER/PBR/ROE in 기업현황 area: look for "PER(배)" / "PBR(배)" / "ROE(지배주주)" headers
  // The values are usually in adjacent td cells.
  let per: number | null = null;
  let pbr: number | null = null;
  let roe: number | null = null;

  $('th').each((_, th) => {
    const label = $(th).text().trim();
    if (per === null && label.startsWith('PER(배)')) {
      const val = $(th).closest('tr').find('td').first().text();
      per = parseFloatLoose(val);
    } else if (pbr === null && label.startsWith('PBR(배)')) {
      const val = $(th).closest('tr').find('td').first().text();
      pbr = parseFloatLoose(val);
    } else if (roe === null && (label === 'ROE(지배주주)' || label.startsWith('ROE'))) {
      const val = $(th).closest('tr').find('td').first().text();
      roe = parseFloatLoose(val);
    }
  });

  // Current price (in case needed)
  const currentText = $('.no_today .blind').first().text();
  const current = parseFloatLoose(currentText);

  return { name, market, industry, per, pbr, roe, current };
}

type NaverSisePage = {
  current: number | null;
  week52High: number | null;
  week52Low: number | null;
};

function parseSisePage(html: string): NaverSisePage {
  const $ = cheerio.load(html);

  const current = parseFloatLoose($('.no_today .blind').first().text());

  let week52High: number | null = null;
  let week52Low: number | null = null;
  $('th.title').each((_, th) => {
    const label = $(th).text().trim();
    const val = $(th).next('td.num').find('span').first().text();
    const num = parseFloatLoose(val);
    if (label === '52주 최고') week52High = num;
    else if (label === '52주 최저') week52Low = num;
  });

  return { current, week52High, week52Low };
}

function parseSiseDayPrice(html: string): number | null {
  // Page shows table.type2 with rows of 날짜, 종가, ...
  // Skip header rows; pick the first valid 종가 from the body.
  const $ = cheerio.load(html);
  let result: number | null = null;
  $('table.type2 tr').each((_, tr) => {
    if (result !== null) return;
    const cells = $(tr).find('td').toArray();
    if (cells.length < 2) return;
    const dateText = $(cells[0]).text().trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateText)) return;
    const closeText = $(cells[1]).text();
    const close = parseFloatLoose(closeText);
    if (close !== null && close > 0) result = close;
  });
  return result;
}

function computeGrowth(current: number | null, previous: number | null): number {
  if (current === null || previous === null) return 0;
  if (previous === 0) return 0;
  const denom = Math.abs(previous);
  return Math.round(((current - previous) / denom) * 1000) / 10;
}

async function fetchSiseDayPriceAtLag(code: string, page: number): Promise<number | null> {
  const url = `https://finance.naver.com/item/sise_day.naver?code=${code}&page=${page}`;
  const html = await fetchNaver(url, 'euckr');
  return parseSiseDayPrice(html);
}

export type FetchStockResult = {
  stock: StockRaw;
  warnings: string[];
};

export async function fetchStockData(code: string): Promise<FetchStockResult> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`Invalid stock code: ${code}`);
  }

  const warnings: string[] = [];

  const [mainHtml, siseHtml, sisePastHtml, dartFin, dartRisks] = await Promise.all([
    fetchNaver(`https://finance.naver.com/item/main.naver?code=${code}`, 'utf8').catch((e) => {
      warnings.push(`item/main fetch fail: ${e.message}`);
      return '';
    }),
    fetchNaver(`https://finance.naver.com/item/sise.naver?code=${code}`, 'euckr').catch((e) => {
      warnings.push(`item/sise fetch fail: ${e.message}`);
      return '';
    }),
    fetchSiseDayPriceAtLag(code, 7).then((p) => ({ page7: p })).catch((e) => {
      warnings.push(`sise_day fetch fail: ${e.message}`);
      return { page7: null };
    }),
    fetchDartFinancials(code).catch((e) => {
      warnings.push(`DART financials fail: ${e.message}`);
      return null;
    }),
    fetchDartRiskFlags(code).catch((e) => {
      warnings.push(`DART risks fail: ${e.message}`);
      return [] as string[];
    }),
  ]);

  const main = mainHtml ? parseItemMain(mainHtml) : ({
    name: '',
    market: null,
    industry: '',
    per: null,
    pbr: null,
    roe: null,
    current: null,
  } as NaverItemMain);
  const sise = siseHtml ? parseSisePage(siseHtml) : ({
    current: null,
    week52High: null,
    week52Low: null,
  } as NaverSisePage);

  if (!main.name) warnings.push('종목명을 못 가져옴 (item/main)');
  if (!main.market) warnings.push('시장 정보를 못 가져옴 — 기본값 KOSPI');
  if (!main.industry) warnings.push('업종 정보를 못 가져옴');
  if (main.per === null) warnings.push('PER 미공시');
  if (main.pbr === null) warnings.push('PBR 미공시');
  if (main.roe === null) warnings.push('ROE 미공시');

  // Financials
  let revenueGrowthRate = 0;
  let operatingProfitGrowthRate = 0;
  let netIncome = 0;
  let operatingCashFlow = 0;
  let operatingCashFlowTwoYearsNegative = false;
  let debtRatio = 0;

  if (dartFin) {
    revenueGrowthRate = computeGrowth(dartFin.current.revenue, dartFin.previous?.revenue ?? null);
    operatingProfitGrowthRate = computeGrowth(
      dartFin.current.operatingProfit,
      dartFin.previous?.operatingProfit ?? null,
    );
    netIncome = dartFin.current.netIncome ?? 0;
    operatingCashFlow = dartFin.current.operatingCashFlow ?? 0;
    const prevOCF = dartFin.previous?.operatingCashFlow ?? null;
    const currOCF = dartFin.current.operatingCashFlow;
    operatingCashFlowTwoYearsNegative = currOCF !== null && currOCF < 0 && prevOCF !== null && prevOCF < 0;
    debtRatio = dartFin.current.debtRatio ?? 0;
  } else {
    warnings.push('DART 재무 데이터 없음 — 성장률/OCF/부채비율 0 처리');
  }

  // Momentum: current vs price ~60 trading days ago (sise_day page 7)
  const pastPrice = (sisePastHtml as { page7: number | null }).page7;
  const currentPrice = sise.current ?? main.current;
  let momentum3m = 0;
  if (pastPrice && currentPrice && pastPrice > 0) {
    momentum3m = Math.round(((currentPrice - pastPrice) / pastPrice) * 1000) / 10;
  } else {
    warnings.push('3개월 모멘텀 산출 실패 — 0 처리');
  }

  const risks: RiskFlag[] = (dartRisks as string[]).filter((r): r is RiskFlag =>
    ['유상증자', '전환사채', '최대주주 변경', '감사의견 위험', '영업현금흐름 2년 연속 음수', '자본잠식 징후', '관리종목'].includes(r),
  );

  if (operatingCashFlowTwoYearsNegative && !risks.includes('영업현금흐름 2년 연속 음수')) {
    risks.push('영업현금흐름 2년 연속 음수');
  }

  const stock: StockRaw = {
    name: main.name || `종목${code}`,
    code,
    market: main.market ?? 'KOSPI',
    industry: main.industry || '미상',
    revenueGrowthRate,
    operatingProfitGrowthRate,
    netIncome,
    operatingCashFlow,
    operatingCashFlowTwoYearsNegative,
    per: main.per,
    pbr: main.pbr,
    roe: main.roe ?? 0,
    debtRatio,
    momentum3m,
    risks,
  };

  return { stock, warnings };
}
