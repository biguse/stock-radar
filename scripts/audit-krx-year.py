#!/usr/bin/env python3
"""특정 연도 전 거래일을 KRX 공식 시세와 전수 대조한다. 읽기 전용.

data/market-history.json 은 절대 수정하지 않는다. 결과만 남긴다.

    python3 scripts/audit-krx-year.py 2026
    python3 scripts/audit-krx-year.py 2026 --start 20260101 --end 20260821

읽기 전용이며 실패 조건이 명시적이다.
  - KRX 응답이 0행이면 실패한다 (조용한 성공을 막는다)
  - 공통 날짜가 --min-common 미만이면 실패한다 (부분 응답을 성공으로 오인하지 않는다)
  - 종가 불일치가 하나라도 있으면 보고서를 남긴 뒤 실패한다
데이터를 고치지 않으며, 자격증명은 어떤 출력에도 남기지 않는다.

남기는 것:
  reports/krx-audit-<연도>.csv    날짜별 대조표
  reports/krx-audit-<연도>.md     요약
  reports/krx-audit-<연도>.raw.json  KRX 응답 원문(종가·시가·고가·저가·거래량)과 SHA-256
"""
import hashlib
import json
import os
import pathlib
import sys
import time
import warnings
from datetime import date, datetime, timezone

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)

_env = pathlib.Path(".env.local")
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# 자격증명이 없으면 KRX는 빈 응답을 준다. 그것을 "일치 0건"으로 읽으면
# 검증하지 않은 것을 검증했다고 착각하게 되므로, 여기서 먼저 멈춘다.
_missing = [k for k in ("KRX_ID", "KRX_PW") if not os.environ.get(k)]
if _missing:
    sys.exit(f"FAIL: {' / '.join(_missing)} 가 없습니다. 인증 없이는 KRX가 빈 응답을 주므로 "
             f"대조를 건너뛰지 않고 실패로 처리합니다.")

from pykrx import stock  # noqa: E402

import argparse

_p = argparse.ArgumentParser(description="연도별 KRX 공식 시세 전수 대조 (읽기 전용)")
_p.add_argument("year", nargs="?", type=int, default=2026)
_p.add_argument("--start", help="조회 시작 YYYYMMDD (기본: 해당 연도 1월 1일)")
_p.add_argument("--end", help="조회 종료 YYYYMMDD (기본: 연말 또는 오늘)")
_p.add_argument("--min-common", type=int, default=150,
                help="양쪽에 공통으로 있어야 하는 최소 날짜 수 (기본 150)")
ARGS = _p.parse_args()
YEAR = ARGS.year
KOSPI = "1001"
TOL_ABS = 0.01          # 종가 절대 허용오차 (소수 둘째 자리)
BIG_MOVE = 3.0          # 이 % 이상 움직인 날은 전부 표시

started = datetime.now(timezone.utc).astimezone()
start = ARGS.start or f"{YEAR}0101"
end = ARGS.end or (f"{YEAR}1231" if YEAR < date.today().year
                   else date.today().strftime("%Y%m%d"))

hist_path = pathlib.Path("data/market-history.json")
hist_raw = hist_path.read_bytes()
rows = json.loads(hist_raw)["rows"]
local_all = {r["d"]: r["kospi"] for r in rows}
local = {d: v for d, v in local_all.items() if d.startswith(str(YEAR))}
# 전일 대비를 재려면 그 해 첫 거래일의 직전 거래일이 필요하다
ordered_all = sorted(local_all)
prev_of = {d: ordered_all[i - 1] for i, d in enumerate(ordered_all) if i > 0}

print(f"KRX 조회: {start} ~ {end} (지수 {KOSPI})", file=sys.stderr)
df = None
for attempt in range(3):
    try:
        df = stock.get_index_ohlcv(start, end, KOSPI)
        break
    except Exception as e:  # noqa: BLE001
        print(f"  시도 {attempt + 1} 실패: {str(e)[:80]}", file=sys.stderr)
        time.sleep(3)
if df is None or len(df) == 0:
    sys.exit("FAIL: KRX 응답이 0행입니다. 인증 실패이거나 조회 기간에 데이터가 없습니다. "
             "빈 응답을 성공으로 처리하지 않습니다.")
finished = datetime.now(timezone.utc).astimezone()

# ── 원문 스냅샷 ────────────────────────────────────────────────
records = []
for idx, r in df.iterrows():
    rec = {"date": idx.strftime("%Y-%m-%d")}
    for col in df.columns:
        v = r[col]
        rec[str(col)] = float(v) if hasattr(v, "item") or isinstance(v, (int, float)) else str(v)
    records.append(rec)
payload = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
resp_sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
krx = {r["date"]: r["종가"] for r in records}

pathlib.Path("reports").mkdir(exist_ok=True)
raw_path = pathlib.Path(f"reports/krx-audit-{YEAR}.raw.json")
raw_path.write_text(json.dumps({
    "queriedAt": started.isoformat(),
    "finishedAt": finished.isoformat(),
    "queryRange": {"start": start, "end": end},
    "index": KOSPI,
    "source": "pykrx stock.get_index_ohlcv (KRX 계정 인증)",
    "pykrxVersion": getattr(__import__("pykrx"), "__version__", "unknown"),
    "columns": [str(c) for c in df.columns],
    "rowCount": len(records),
    "responseSha256": resp_sha,
    "localFileSha256": hashlib.sha256(hist_raw).hexdigest(),
    "records": records,
}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

# ── 대조 ──────────────────────────────────────────────────────
both = sorted(set(local) & set(krx))
only_local = sorted(set(local) - set(krx))
only_krx = sorted(set(krx) - set(local))

def ret(series, d):
    p = prev_of.get(d)
    if p is None or p not in series or not series[p]:
        return None
    return (series[d] / series[p] - 1) * 100

krx_all = dict(krx)          # KRX 전일 대비는 KRX 자체 계열로 계산
krx_ordered = sorted(krx)
krx_prev = {d: krx_ordered[i - 1] for i, d in enumerate(krx_ordered) if i > 0}

def krx_ret(d):
    p = krx_prev.get(d)
    if p is None:
        return None
    return (krx[d] / krx[p] - 1) * 100

table = []
for d in both:
    lo, kr = local[d], krx[d]
    diff = lo - kr
    rel = (diff / kr * 100) if kr else None
    lr, kr_r = ret(local_all, d), krx_ret(d)
    table.append({
        "date": d, "local": lo, "krx": kr,
        "absDiff": diff, "relDiffPct": rel,
        "localRetPct": lr, "krxRetPct": kr_r,
        "retDiffPct": (lr - kr_r) if (lr is not None and kr_r is not None) else None,
        "match": abs(diff) <= TOL_ABS,
        "bigMove": (lr is not None and abs(lr) >= BIG_MOVE) or (kr_r is not None and abs(kr_r) >= BIG_MOVE),
    })

mismatch = [t for t in table if not t["match"]]
big = [t for t in table if t["bigMove"]]

def f(v, nd=2):
    return "" if v is None else f"{v:.{nd}f}"

csv_path = pathlib.Path(f"reports/krx-audit-{YEAR}.csv")
lines = ["date,local_close,krx_close,abs_diff,rel_diff_pct,local_ret_pct,krx_ret_pct,ret_diff_pct,match,big_move"]
for t in table:
    lines.append(",".join([
        t["date"], f(t["local"]), f(t["krx"]), f(t["absDiff"], 4), f(t["relDiffPct"], 4),
        f(t["localRetPct"], 4), f(t["krxRetPct"], 4), f(t["retDiffPct"], 4),
        "1" if t["match"] else "0", "1" if t["bigMove"] else "0"]))
for d in only_local:
    lines.append(f"{d},{local[d]:.2f},,,,,,,0,")
for d in only_krx:
    lines.append(f"{d},,{krx[d]:.2f},,,,,,0,")
csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

# ── 요약 ──────────────────────────────────────────────────────
md = []
A = md.append
A(f"# KRX 공식 시세 전수 대조 — {YEAR}년\n")
A("읽기 전용 보고서입니다. `data/market-history.json` 은 수정하지 않았습니다.\n")
A("## 조회 기록\n")
A("| 항목 | 값 |")
A("|---|---|")
A(f"| 조회 시각 | {started.isoformat()} |")
A(f"| 완료 시각 | {finished.isoformat()} |")
A(f"| 조회 기간 | {start} ~ {end} |")
A(f"| 지수 | KOSPI ({KOSPI}) |")
A(f"| 출처 | pykrx `get_index_ohlcv` (KRX 계정 인증) |")
A(f"| 응답 행 수 | {len(records):,} |")
A(f"| 응답 SHA-256 | `{resp_sha}` |")
A(f"| 로컬 파일 SHA-256 | `{hashlib.sha256(hist_raw).hexdigest()}` |")
A(f"| 원문 저장 | `{raw_path}` |\n")
A("## 결과\n")
A("| 항목 | 수 |")
A("|---|---|")
A(f"| 양쪽에 있는 날짜 | {len(both):,} |")
A(f"| 종가 일치 (±{TOL_ABS}) | {len(both) - len(mismatch):,} |")
A(f"| **종가 불일치** | **{len(mismatch):,}** |")
A(f"| 로컬에만 있는 날짜 | {len(only_local):,} |")
A(f"| KRX에만 있는 날짜 | {len(only_krx):,} |")
A(f"| ±{BIG_MOVE}% 이상 움직인 날 | {len(big):,} |\n")

if only_local:
    A("### 로컬에만 있는 날짜\n")
    A("| 날짜 | 로컬 종가 |")
    A("|---|---|")
    for d in only_local:
        A(f"| {d} | {local[d]:,.2f} |")
    A("")
if only_krx:
    A("### KRX에만 있는 날짜\n")
    A("| 날짜 | KRX 종가 |")
    A("|---|---|")
    for d in only_krx:
        A(f"| {d} | {krx[d]:,.2f} |")
    A("")

if mismatch:
    A(f"### 종가 불일치 {len(mismatch)}건\n")
    A("| 날짜 | 로컬 | KRX | 차이 | 상대차 | 로컬 전일비 | KRX 전일비 | 전일비 차이 |")
    A("|---|---|---|---|---|---|---|---|")
    for t in mismatch:
        A(f"| {t['date']} | {t['local']:,.2f} | {t['krx']:,.2f} | {t['absDiff']:+,.2f} | "
          f"{f(t['relDiffPct'], 3)}% | {f(t['localRetPct'])}% | {f(t['krxRetPct'])}% | "
          f"{f(t['retDiffPct'])}%p |")
    A("")

A(f"### ±{BIG_MOVE}% 이상 움직인 날 전부 ({len(big)}건)\n")
A("| 날짜 | 로컬 | KRX | 차이 | 로컬 전일비 | KRX 전일비 | 전일비 차이 | 종가 |")
A("|---|---|---|---|---|---|---|---|")
for t in big:
    A(f"| {t['date']} | {t['local']:,.2f} | {t['krx']:,.2f} | {t['absDiff']:+,.2f} | "
      f"{f(t['localRetPct'])}% | {f(t['krxRetPct'])}% | {f(t['retDiffPct'])}%p | "
      f"{'일치' if t['match'] else '**불일치**'} |")
A("")
A(f"전체 대조표는 `{csv_path}` 에 있습니다.\n")

md_path = pathlib.Path(f"reports/krx-audit-{YEAR}.md")
md_path.write_text("\n".join(md), encoding="utf-8")

print(f"\n{YEAR}년 대조 완료")
print(f"  양쪽 공통 {len(both):,}일 · 불일치 {len(mismatch):,}건 · "
      f"로컬 단독 {len(only_local)}일 · KRX 단독 {len(only_krx)}일 · 큰변동 {len(big)}일")
print(f"  {csv_path}\n  {md_path}\n  {raw_path}")
print(f"  응답 SHA-256 {resp_sha}")

# ── 실패 판정 — 데이터는 고치지 않고 종료코드로만 알린다 ─────────────
fail = []
if len(both) < ARGS.min_common:
    fail.append(f"공통 날짜가 {len(both)}일로 최소 기준 {ARGS.min_common}일에 못 미칩니다")
if mismatch:
    fail.append(f"종가 불일치 {len(mismatch)}건")
if only_local:
    fail.append(f"로컬에만 있는 날짜 {len(only_local)}일")
if only_krx:
    fail.append(f"KRX에만 있는 날짜 {len(only_krx)}일")

if fail:
    print("\nFAIL — " + " / ".join(fail), file=sys.stderr)
    print("데이터 파일은 수정하지 않았습니다. 보고서를 확인하세요.", file=sys.stderr)
    sys.exit(1)
print("\nPASS — 로컬 종가가 KRX 공식값과 전부 일치합니다.")
sys.exit(0)
