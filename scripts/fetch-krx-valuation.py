"""
코스피 지수 PER/PBR/배당수익률 수집 (pykrx, KRX 계정 필요)

출력: data/krx-valuation.json  {"YYYY-MM-DD": {"per":x,"pbr":y,"dy":z}, ...}

KRX가 데이터 포털을 로그인 뒤로 옮겨서 계정이 필요하다.
자격증명은 .env.local의 KRX_ID / KRX_PW에서 읽는다 (git에 올리지 않음).

실행: /tmp/krxenv/bin/python scripts/fetch-krx-valuation.py [시작연도]
"""
import os, sys, json, time, warnings, pathlib
warnings.filterwarnings('ignore')

for line in pathlib.Path('.env.local').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ[k.strip()] = v.strip()

from pykrx import stock
from datetime import date

START_YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2001
END_YEAR = date.today().year
KOSPI = "1001"

out = {}
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
pathlib.Path("data/krx-valuation.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
days = sorted(out)
per_days = [d for d in days if "per" in out[d]]
pbr_days = [d for d in days if "pbr" in out[d]]
print(f"\n총 {len(days)}일  ({days[0]} ~ {days[-1]})")
print(f"  PER 보유 {len(per_days)}일 (최초 {per_days[0] if per_days else '-'})")
print(f"  PBR 보유 {len(pbr_days)}일 (최초 {pbr_days[0] if pbr_days else '-'})")
