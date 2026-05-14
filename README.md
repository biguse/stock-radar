# 매수 후보 레이더 (stock-radar)

개인 투자 판단용 한국 주식 매수 후보 선별 대시보드 MVP입니다.

지금 살 만한 후보인지, 더 기다릴 종목인지, 아예 피할 종목인지 한 화면에서 빠르게 가르기 위해
만들었습니다. **공개 서비스가 아니라 본인 판단 보조용** 도구입니다.

이 첫 버전은 실제 DART/KRX API를 붙이지 않습니다. `data/stocks.sample.json`에 들어있는
**가상 종목** 더미 데이터로 화면, 점수 모델, 필터, 정렬, 리스크 표시까지 동작합니다.

---

## 1. 이 프로젝트가 무엇인지

- 한국 주식 매수 후보를 한 화면에서 점수화·필터링·정렬·리스크 표시까지 한 번에 보기 위한 개인 대시보드
- 종목별 메모를 브라우저(localStorage)에 저장해서 새로고침해도 유지
- 등급(S/A/B/C/D/X)과 행동 제안(깊게 보기 / 관찰 / 대기 / 피함)을 자동으로 산출
- **외부 DB 없음**, **외부 API 없음**, 그냥 `npm run dev` 하면 끝

스택: Next.js (App Router) + TypeScript + Tailwind CSS + JSON 데이터.

---

## 2. 설치 방법

처음이라면 한 번만 해주세요.

1. [Node.js 20](https://nodejs.org/) 설치 (LTS 권장)
2. 이 저장소를 받기

```bash
git clone https://github.com/biguse/stock-radar.git
cd stock-radar
npm install
```

`npm install`이 끝나면 `package-lock.json`이 같이 생깁니다. GitHub Actions가 `npm ci`로
설치하기 때문에 이 파일은 **반드시 커밋해야 합니다.**

---

## 3. 실행 방법

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 열기.

상단 요약 박스, 필터, 정렬, 종목 카드가 보이면 성공입니다.

---

## 4. 빌드 확인 방법

배포 전, 또는 코드를 크게 바꾼 다음에는 아래 두 명령으로 검증합니다.

```bash
npm run typecheck   # 타입 오류 확인
npm run build       # 프로덕션 빌드 확인
```

GitHub에 push하면 `.github/workflows/build.yml`이 자동으로 같은 검증을 돌립니다.

---

## 5. 데이터 수정 방법

종목 데이터는 모두 [data/stocks.sample.json](./data/stocks.sample.json)에 있습니다.
이 파일만 수정하면 됩니다.

각 항목 형식 (모든 금액 단위: 억원, 비율 단위: %):

```json
{
  "name": "회사 이름",
  "code": "910001",
  "market": "KOSPI",
  "industry": "업종",
  "revenueGrowthRate": 18.0,
  "operatingProfitGrowthRate": 25.0,
  "netIncome": 3200,
  "operatingCashFlow": 5400,
  "operatingCashFlowTwoYearsNegative": false,
  "per": 9.1,
  "pbr": 1.5,
  "roe": 18.2,
  "debtRatio": 45,
  "momentum3m": 18.4,
  "risks": []
}
```

리스크 플래그(`risks`)에 넣을 수 있는 값:

- `"유상증자"` — 최근 1년 유상증자 (-10점)
- `"전환사채"` — 최근 1년 전환사채 발행 (-10점)
- `"최대주주 변경"` — 최근 1년 최대주주 변경 (-15점)
- `"감사의견 위험"` — 감사의견 비적정 우려 (-30점)
- `"영업현금흐름 2년 연속 음수"` — (-20점)
- `"자본잠식 징후"` — **강제 X**
- `"관리종목"` — **강제 X**

저장하면 `npm run dev` 중인 페이지가 자동 새로고침 됩니다.

---

## 6. 점수 모델 설명

총 100점 만점. 6가지 지표 합산 후 리스크 감점, 강제 X 조건 적용.

| 항목 | 만점 | 핵심 기준 |
|---|---|---|
| 성장성 | 25 | 매출 증가율 + 영업이익 증가율 |
| 수익성 | 20 | 흑자 여부 + ROE 구간 |
| 현금흐름 | 20 | 영업현금흐름 절대 규모, 2년 연속 음수면 0 |
| 재무안정성 | 15 | 부채비율 구간 |
| 밸류에이션 | 10 | PER + PBR 구간 (적자면 거의 0) |
| 모멘텀 | 10 | 3개월 주가 등락률 구간 |

리스크 감점:

- 유상증자 -10
- 전환사채 -10
- 최대주주 변경 -15
- 감사의견 위험 -30
- 영업현금흐름 2년 연속 음수 -20
- 자본잠식 징후 → **강제 X** (점수와 무관하게 X)
- 관리종목 → **강제 X**

등급:

| 점수 | 등급 | 행동 제안 |
|---|---|---|
| 85 이상 | S | 깊게 보기 |
| 75 이상 | A | 관찰 |
| 65 이상 | B | 관찰 |
| 50 이상 | C | 대기 |
| 35 이상 | D | 피함 |
| 35 미만 또는 강제 X | X | 피함 |

코드 위치:

- 점수 계산: [lib/scoring.ts](./lib/scoring.ts)
- 리스크 판단: [lib/riskFlags.ts](./lib/riskFlags.ts)
- "왜 올라왔나" / "왜 위험한가" 문구: [lib/reasons.ts](./lib/reasons.ts)
- 필터 / 정렬: [lib/filters.ts](./lib/filters.ts)

점수 구간 수정은 위 파일에서 숫자만 바꾸면 바로 반영됩니다.

---

## 7. 다음 단계

처음 버전은 더미 데이터까지. 다음 마일스톤 후보:

1. **실제 종목 CSV 입력** — 보유 종목 + 관심 종목 CSV를 읽어와 자동 채움
2. **DART API 연동** — 재무제표, 유상증자/CB 공시, 최대주주 변경, 감사의견 자동 수집
3. **KRX 데이터 연동** — 시가/PER/PBR/3M 수익률 일배치
4. **관심종목 저장** — 별표 + localStorage (현재는 메모만 지원)
5. **종목 상세 페이지** — 카드 클릭 시 `/stocks/[code]` 진입, 분기별 추이
6. **차트 추가** — 점수 추이, 분기 매출/영업이익, 주가 모멘텀

이 모든 단계에서 `data/stocks.sample.json` 스키마와 [types/stock.ts](./types/stock.ts)만
일치시키면 화면 코드는 거의 그대로 재사용됩니다.
