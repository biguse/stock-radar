"""
코스피 지수 PER/PBR/배당수익률 수집 (pykrx, KRX 계정 필요)

출력: data/krx-valuation.json  {"YYYY-MM-DD": {"per":x,"pbr":y,"dy":z}, ...}

KRX가 데이터 포털을 로그인 뒤로 옮겨서 계정이 필요하다.
자격증명은 .env.local의 KRX_ID / KRX_PW에서 읽는다 (git에 올리지 않음).

기본은 증분 모드 — 기존 파일의 마지막 날짜 이후만 받는다.
전체 재수집은 --full (2001년부터).

실행: python scripts/fetch-krx-valuation.py           # 증분
      python scripts/fetch-krx-valuation.py --full    # 전체
"""
import os, sys, json, time, warnings, pathlib
warnings.filterwarnings('ignore')

# 로컬에서는 .env.local, CI에서는 GitHub Secrets(환경변수)를 쓴다
_env = pathlib.Path('.env.local')
if _env.exists():
    for line in _env.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

if not os.environ.get('KRX_ID') or not os.environ.get('KRX_PW'):
    print('KRX_ID / KRX_PW 가 없습니다. 밸류에이션 갱신을 건너뜁니다.', file=sys.stderr)
    sys.exit(0)

from pykrx import stock
from datetime import date

OUT_PATH = pathlib.Path("data/krx-valuation.json")
FULL = "--full" in sys.argv
KOSPI = "1001"
END_YEAR = date.today().year

# 기존 데이터를 불러 증분 기준점을 잡는다
out = {}
if OUT_PATH.exists() and not FULL:
    out = json.loads(OUT_PATH.read_text(encoding="utf-8"))

if FULL or not out:
    START_YEAR = 2001
    print("전체 수집 모드 (2001~)")
else:
    last = max(out)
    START_YEAR = int(last[:4])
    print(f"증분 수집 모드 — 기존 {len(out)}일, 마지막 {last}")
for year in range(START_YEAR, END_YEAR + 1):
    a = f"{year}0101"
    b = f"{year}1231" if year < END_YEAR else date.today().strftime("%Y%m%d")
    for attempt in range(3):
        try:
            df = stock.get_index_fundamental(a, b, KOSPI)
            break
        except Exception as e:
            if attempt == 2:
                print(f"  {year} 실패: {e}", file=sys.stderr)
                df = None
            time.sleep(2)
    if df is None or len(df) == 0:
        print(f"  {year}: 0일")
        continue
    n = 0
    for idx, row in df.iterrows():
        d = idx.strftime("%Y-%m-%d")
        per = float(row.get("PER", 0) or 0)
        pbr = float(row.get("PBR", 0) or 0)
        dy = float(row.get("배당수익률", 0) or 0)
        # 0은 결측 처리 (초기 구간에 PBR=0 같은 값이 있다)
        rec = {}
        if per > 0: rec["per"] = round(per, 2)
        if pbr > 0: rec["pbr"] = round(pbr, 3)
        if dy > 0: rec["dy"] = round(dy, 2)
        if rec:
            out[d] = rec
            n += 1
    print(f"  {year}: {n}일")
    time.sleep(0.4)

pathlib.Path("data").mkdir(exist_ok=True)
out = {k: out[k] for k in sorted(out)}
OUT_PATH.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
days = sorted(out)
per_days = [d for d in days if "per" in out[d]]
pbr_days = [d for d in days if "pbr" in out[d]]
print(f"\n총 {len(days)}일  ({days[0]} ~ {days[-1]})")
print(f"  PER 보유 {len(per_days)}일 (최초 {per_days[0] if per_days else '-'})")
print(f"  PBR 보유 {len(pbr_days)}일 (최초 {pbr_days[0] if pbr_days else '-'})")
