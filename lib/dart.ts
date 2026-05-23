import AdmZip from 'adm-zip';

const DART_BASE = 'https://opendart.fss.or.kr/api';

function getApiKey(): string {
  const key = process.env.DART_API_KEY;
  if (!key) {
    throw new Error('DART_API_KEY env var not set. Get one at https://opendart.fss.or.kr');
  }
  return key;
}

export type DartFinancialYear = {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  totalDebt: number | null;
  totalEquity: number | null;
  debtRatio: number | null;
};

export type DartFinancials = {
  current: DartFinancialYear;
  previous: DartFinancialYear | null;
  beforePrevious: DartFinancialYear | null;
};

export type DartDisclosure = {
  reportName: string;
  receivedDate: string; // YYYYMMDD
  rceptNo: string;
};

type CorpMapping = { [stockCode: string]: { corpCode: string; corpName: string } };

let corpMappingPromise: Promise<CorpMapping> | null = null;

function loadCorpMapping(): Promise<CorpMapping> {
  if (!corpMappingPromise) {
    corpMappingPromise = (async () => {
      const key = getApiKey();
      const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${key}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`DART corpCode fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // Could be ZIP (success) or XML error message
      const head = buf.slice(0, 5).toString('utf-8');
      if (head.startsWith('<?xml')) {
        const xml = buf.toString('utf-8');
        const msg = xml.match(/<message>(.*?)<\/message>/)?.[1] ?? 'unknown error';
        throw new Error(`DART corpCode error: ${msg}`);
      }

      const zip = new AdmZip(buf);
      const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.xml'));
      if (!entry) throw new Error('DART corpCode ZIP has no XML entry');
      const xml = entry.getData().toString('utf-8');

      const mapping: CorpMapping = {};
      const entryRegex = /<list>([\s\S]*?)<\/list>/g;
      let m: RegExpExecArray | null;
      while ((m = entryRegex.exec(xml)) !== null) {
        const block = m[1];
        const corpCode = block.match(/<corp_code>(.*?)<\/corp_code>/)?.[1]?.trim();
        const corpName = block.match(/<corp_name>(.*?)<\/corp_name>/)?.[1]?.trim();
        const stockCode = block.match(/<stock_code>(.*?)<\/stock_code>/)?.[1]?.trim();
        if (corpCode && stockCode && /^\d{6}$/.test(stockCode)) {
          mapping[stockCode] = { corpCode, corpName: corpName ?? '' };
        }
      }
      return mapping;
    })().catch((e) => {
      corpMappingPromise = null;
      throw e;
    });
  }
  return corpMappingPromise;
}

export async function getCorpCode(stockCode: string): Promise<{ corpCode: string; corpName: string } | null> {
  const mapping = await loadCorpMapping();
  return mapping[stockCode] ?? null;
}

function parseAmount(str: string | undefined | null): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  // DART amounts are in 원. Convert to 억원.
  return Math.round(n / 100_000_000);
}

type DartAcntItem = {
  account_nm: string;
  account_id?: string;
  sj_div: 'BS' | 'IS' | 'CIS' | 'CF' | 'SCE';
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
};

function pickAccount(
  items: DartAcntItem[],
  sj: string | string[],
  options: { ids?: string[]; names?: string[] },
): DartAcntItem | undefined {
  const sjs = Array.isArray(sj) ? sj : [sj];
  if (options.ids && options.ids.length > 0) {
    const byId = items.find(
      (it) => sjs.includes(it.sj_div) && options.ids!.some((id) => it.account_id === id),
    );
    if (byId) return byId;
  }
  if (options.names && options.names.length > 0) {
    return items.find(
      (it) => sjs.includes(it.sj_div) && options.names!.some((n) => it.account_nm.includes(n)),
    );
  }
  return undefined;
}

function pickYearValue(item: DartAcntItem | undefined, which: 'thstrm' | 'frmtrm' | 'bfefrmtrm'): number | null {
  if (!item) return null;
  if (which === 'thstrm') return parseAmount(item.thstrm_amount);
  if (which === 'frmtrm') return parseAmount(item.frmtrm_amount);
  return parseAmount(item.bfefrmtrm_amount);
}

function buildYear(items: DartAcntItem[], which: 'thstrm' | 'frmtrm' | 'bfefrmtrm', yearLabel: string): DartFinancialYear {
  const revenue = pickYearValue(
    pickAccount(items, ['IS', 'CIS'], {
      ids: ['ifrs-full_Revenue', 'dart_OperatingRevenue'],
      names: ['매출액', '수익(매출액)', '영업수익'],
    }),
    which,
  );
  const operatingProfit = pickYearValue(
    pickAccount(items, ['IS', 'CIS'], {
      ids: ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'],
      names: ['영업이익'],
    }),
    which,
  );
  const netIncome = pickYearValue(
    pickAccount(items, ['IS', 'CIS'], {
      ids: ['ifrs-full_ProfitLoss'],
      names: ['당기순이익', '분기순이익', '반기순이익', '연결당기순이익'],
    }),
    which,
  );
  const operatingCashFlow = pickYearValue(
    pickAccount(items, 'CF', {
      ids: [
        'ifrs-full_CashFlowsFromUsedInOperatingActivities',
        'dart_CashFlowsFromUsedInOperatingActivities',
      ],
      names: ['영업활동현금흐름', '영업활동으로인한현금흐름'],
    }),
    which,
  );
  const totalDebt = pickYearValue(
    pickAccount(items, 'BS', { ids: ['ifrs-full_Liabilities'], names: ['부채총계'] }),
    which,
  );
  const totalEquity = pickYearValue(
    pickAccount(items, 'BS', {
      ids: ['ifrs-full_Equity', 'ifrs-full_EquityAttributableToOwnersOfParent'],
      names: ['자본총계'],
    }),
    which,
  );
  const debtRatio =
    totalDebt !== null && totalEquity !== null && totalEquity > 0
      ? Math.round((totalDebt / totalEquity) * 1000) / 10
      : null;
  return { year: yearLabel, revenue, operatingProfit, netIncome, operatingCashFlow, totalDebt, totalEquity, debtRatio };
}

const ANNUAL_REPORT = '11011';
const QUARTERLY_REPORTS = ['11014', '11012', '11013']; // 3Q, 반기, 1Q

async function tryFetchReport(
  corpCode: string,
  bsnsYear: number,
  reprtCode: string,
): Promise<DartAcntItem[] | null> {
  const key = getApiKey();
  const url = `${DART_BASE}/fnlttSinglAcntAll.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=CFS`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    status?: string;
    message?: string;
    list?: DartAcntItem[];
  } | null;
  if (!json || json.status !== '000' || !Array.isArray(json.list) || json.list.length === 0) return null;
  return json.list;
}

export async function fetchDartFinancials(stockCode: string, year?: number): Promise<DartFinancials | null> {
  const mapped = await getCorpCode(stockCode);
  if (!mapped) return null;

  const targetYear = year ?? new Date().getFullYear();

  // Prefer most recent ANNUAL report (frmtrm/bfefrmtrm carry prior years for YoY growth)
  for (const tryYear of [targetYear, targetYear - 1, targetYear - 2]) {
    const items = await tryFetchReport(mapped.corpCode, tryYear, ANNUAL_REPORT);
    if (!items) continue;
    return {
      current: buildYear(items, 'thstrm', `${tryYear}-annual`),
      previous: buildYear(items, 'frmtrm', `${tryYear - 1}-annual`),
      beforePrevious: buildYear(items, 'bfefrmtrm', `${tryYear - 2}-annual`),
    };
  }

  // Fallback to quarterly (frmtrm tends to be empty, so growth will be 0)
  for (const tryYear of [targetYear, targetYear - 1]) {
    for (const reprt of QUARTERLY_REPORTS) {
      const items = await tryFetchReport(mapped.corpCode, tryYear, reprt);
      if (!items) continue;
      return {
        current: buildYear(items, 'thstrm', `${tryYear}-${reprt}`),
        previous: buildYear(items, 'frmtrm', `${tryYear - 1}-${reprt}`),
        beforePrevious: buildYear(items, 'bfefrmtrm', `${tryYear - 2}-${reprt}`),
      };
    }
  }

  return null;
}

const RISK_KEYWORDS: { keyword: string; flag: string }[] = [
  { keyword: '유상증자결정', flag: '유상증자' },
  { keyword: '주주배정후 실권주 일반공모', flag: '유상증자' },
  { keyword: '전환사채권발행결정', flag: '전환사채' },
  { keyword: '교환사채권발행결정', flag: '전환사채' },
  { keyword: '최대주주변경', flag: '최대주주 변경' },
  { keyword: '감사보고서 미제출', flag: '감사의견 위험' },
  { keyword: '감사의견 의견거절', flag: '감사의견 위험' },
  { keyword: '감사의견 한정', flag: '감사의견 위험' },
  { keyword: '감사의견 부적정', flag: '감사의견 위험' },
  { keyword: '관리종목지정', flag: '관리종목' },
];

export async function fetchDartRiskFlags(stockCode: string, withinDays = 365): Promise<string[]> {
  const key = getApiKey();
  const mapped = await getCorpCode(stockCode);
  if (!mapped) return [];

  const end = new Date();
  const start = new Date(end.getTime() - withinDays * 86400_000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const url = `${DART_BASE}/list.json?crtfc_key=${key}&corp_code=${mapped.corpCode}&bgn_de=${fmt(start)}&end_de=${fmt(end)}&page_count=100`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as {
    status?: string;
    list?: { report_nm?: string; rcept_dt?: string }[];
  } | null;
  if (!json || json.status !== '000' || !Array.isArray(json.list)) return [];

  const flags = new Set<string>();
  for (const item of json.list) {
    const name = item.report_nm ?? '';
    for (const r of RISK_KEYWORDS) {
      if (name.includes(r.keyword)) flags.add(r.flag);
    }
  }
  return Array.from(flags);
}
