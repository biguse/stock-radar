#!/usr/bin/env python3
"""VERIFY.md의 주장을 독립적으로 재계산하는 교차검증 스크립트.

원본은 외부 검증자(Codex)가 작성했고, 상시 회귀 테스트로 쓰기 위해
--json / --api 옵션을 추가했다.

    python3 scripts/verify_claims.py                     # 진단 리포트
    python3 scripts/verify_claims.py --json              # 기계 판독용
    python3 scripts/verify_claims.py --api <URL>         # 운영 API와 대조

TypeScript 구현을 일절 import하지 않는다. data/market-history.json에서
가격 온도 시계열을 처음부터 다시 만들어 계산한다. 두 구현이 어긋나면
--api 모드가 종료코드 1로 실패한다.
"""

import json
import math
import random
import sys
from bisect import bisect_left, insort
from pathlib import Path

import numpy as np
from scipy import stats


ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "data/market-history.json").read_text())["rows"]
PRICES = np.array([r["kospi"] for r in ROWS], dtype=float)
DATES = np.array([r["d"] for r in ROWS])
H = 252


def percentile_series(values, warmup=750):
    sample, out = [], []
    for value in values:
        if value is None or not math.isfinite(value):
            out.append(None)
        elif len(sample) < warmup:
            insort(sample, value)
            out.append(None)
        else:
            out.append(100.0 * bisect_left(sample, value) / len(sample))
            insort(sample, value)
    return out


def temperature(ma=1250, warmup=750):
    # Price axis only. The checked-in data have the other four context fields
    # on every row, so their readiness gate does not delay this series further.
    cs = np.r_[0.0, np.cumsum(PRICES)]
    dev = [None] * len(PRICES)
    for i in range(ma - 1, len(PRICES)):
        avg = (cs[i + 1] - cs[i + 1 - ma]) / ma
        dev[i] = 100.0 * (PRICES[i] / avg - 1.0)
    pct = percentile_series(dev, warmup)
    return [(i, round(x, 1)) for i, x in enumerate(pct) if x is not None]


def corr(x, y):
    return float(np.corrcoef(x, y)[0, 1]) if len(x) >= 3 else float("nan")


def nonoverlap(series, offset=0):
    x, y = [], []
    for j in range(offset, len(series) - H, H):
        i, t = series[j]
        k = series[j + H][0]  # matches production: 252 rows in temperature series
        x.append(t)
        y.append(100.0 * (PRICES[k] / PRICES[i] - 1.0))
    return np.asarray(x), np.asarray(y)


def bucket_pairs(series):
    out = []
    for j in range(len(series) - H):
        i, t = series[j]
        k = series[j + H][0]
        out.append((min(int(t // 20), 4), 100.0 * (PRICES[k] / PRICES[i] - 1.0)))
    return out


def walk_forward(series, stride=21, min_train=750):
    """Independent translation of the documented walk-forward algorithm."""
    entries = []
    for j in range(0, len(series) - H, stride):
        train_end = j - H
        if train_end < min_train:
            continue
        train_pairs = bucket_pairs(series[:train_end])
        groups = {b: [] for b in range(5)}
        for b, value in train_pairs:
            groups[b].append(value)
        i, temp = series[j]
        # Production bucket lookup uses temp < 100; an exact 100 has no bucket.
        if temp >= 100:
            continue
        b = min(int(temp // 20), 4)
        if len(groups[b]) < 20:
            continue
        predicted = round(float(np.median(groups[b])), 1)
        k = series[j + H][0]
        actual = 100.0 * (PRICES[k] / PRICES[i] - 1.0)
        entries.append((predicted >= 0, actual >= 0))
    return np.asarray(entries, dtype=bool)


def block_bootstrap_binary(entries, reps=20000, block=12, seed=20260822):
    """Monthly entries have a one-year target, hence ~12-entry blocks."""
    rng = np.random.default_rng(seed)
    n = len(entries)
    hit, diff = [], []
    for _ in range(reps):
        idx = []
        while len(idx) < n:
            start = int(rng.integers(n))
            idx.extend((start + np.arange(block)) % n)
        draw = entries[np.asarray(idx[:n])]
        model = np.mean(draw[:, 0] == draw[:, 1])
        always_up = np.mean(draw[:, 1])
        hit.append(model)
        diff.append(model - always_up)
    return np.percentile(hit, [2.5, 97.5]), np.percentile(diff, [2.5, 97.5])


def moving_block_ci(pairs, reps=2000, block=252, seed=20260822):
    """Circular moving-block bootstrap, resampling the dated pair sequence."""
    rng = random.Random(seed)
    n = len(pairs)
    estimates = {b: {"median": [], "negative": []} for b in range(5)}
    for _ in range(reps):
        draw = []
        while len(draw) < n:
            start = rng.randrange(n)
            draw.extend(pairs[(start + k) % n] for k in range(block))
        groups = {b: [] for b in range(5)}
        for b, value in draw[:n]:
            groups[b].append(value)
        for b, values in groups.items():
            estimates[b]["median"].append(float(np.median(values)))
            estimates[b]["negative"].append(100.0 * np.mean(np.asarray(values) < 0))
    result = {}
    for b in range(5):
        result[b] = {
            name: tuple(np.percentile(values, [2.5, 97.5]))
            for name, values in estimates[b].items()
        }
    return result


def up_rate(days):
    changes = PRICES[days:] > PRICES[:-days]
    return 100.0 * changes.mean(), len(changes)


def holding(days, cost):
    rets = PRICES[days:] / PRICES[:-days] - 1
    gains = rets[rets > 0]
    losses = -rets[rets <= 0]
    ag, al = gains.mean(), losses.mean()
    return 100 * (rets > 0).mean(), 100 * (al + cost) / (ag + al)


def headline_numbers():
    """운영 API와 대조할 핵심 수치만 뽑는다."""
    series = temperature()
    out = {}
    for h in [1, 5, 21, 63, 252, 756, 1260]:
        p, _ = up_rate(h)
        out[f"up_{h}"] = round(p, 1)
    out["breakeven_daily_stock"] = round(holding(1, 0.0028)[1], 1)
    x, y = nonoverlap(series)
    out["nonoverlap_corr"] = round(corr(x, y), 3)
    out["nonoverlap_n"] = len(x)
    wf = walk_forward(series)
    out["wf_n"] = int(len(wf))
    out["wf_hit"] = round(100 * float(np.mean(wf[:, 0] == wf[:, 1])), 1)
    out["wf_baseline_always_up"] = round(100 * float(np.mean(wf[:, 1])), 1)
    return out


def compare_with_api(url):
    """독립 계산 결과를 운영 API 응답과 대조. 어긋나면 종료코드 1."""
    import urllib.request

    mine = headline_numbers()
    with urllib.request.urlopen(url, timeout=120) as r:
        api = json.loads(r.read().decode())

    checks = []

    def add(name, theirs, ours, tol):
        ok = theirs is not None and abs(theirs - ours) <= tol
        checks.append((name, ours, theirs, tol, ok))

    by_h = {h["days"]: h for h in api["probability"]["byHorizon"]}
    for days in [1, 5, 21, 63, 252, 756, 1260]:
        add(f"상승확률 {days}일", by_h.get(days, {}).get("pUp"), mine[f"up_{days}"], 0.15)

    daily = next((h for h in api["cost"]["holdings"] if h["days"] == 1), {})
    add("하루 손익분기", daily.get("breakEvenStock"), mine["breakeven_daily_stock"], 0.2)

    add("비중첩 상관", api["honest"]["correlation"], mine["nonoverlap_corr"], 0.02)
    add("비중첩 표본수", api["honest"]["n"], mine["nonoverlap_n"], 1)

    sc = api["scorecard"]
    add("워크포워드 적중률", sc["hitRate"], mine["wf_hit"], 1.5)
    add("워크포워드 기준선", sc.get("baselineAlwaysUp"), mine["wf_baseline_always_up"], 1.5)

    print("독립 재계산 ↔ 운영 API 대조\n")
    print(f"{'항목':<20}{'독립계산':>10}{'API':>10}{'허용오차':>9}  판정")
    failed = 0
    for name, ours, theirs, tol, ok in checks:
        mark = "일치" if ok else "불일치"
        if not ok:
            failed += 1
        shown = "None" if theirs is None else f"{theirs:.2f}"
        print(f"{name:<20}{ours:>10.2f}{shown:>10}{tol:>9.2f}  {mark}")

    # 구조적 점검: 1년 지평에서 50%를 기준선으로 주장하고 있지 않은가
    if sc.get("baselineAlwaysUp") is None:
        print("\n구조 오류: scorecard에 baselineAlwaysUp이 없습니다. "
              "1년 지평의 기준선은 50%가 아니라 '항상 상승'입니다.")
        failed += 1
    elif sc["hitRate"] < sc["baselineAlwaysUp"] and sc.get("edgeVsBaseline", 0) > 0:
        print("\n구조 오류: 기준선보다 낮은데 우위로 보고하고 있습니다.")
        failed += 1

    print(f"\n{len(checks) - failed}/{len(checks)} 일치" + ("" if failed == 0 else f" · {failed}건 불일치"))
    return 1 if failed else 0


def main():
    if "--json" in sys.argv:
        print(json.dumps(headline_numbers(), ensure_ascii=False, indent=2))
        return 0
    if "--api" in sys.argv:
        return compare_with_api(sys.argv[sys.argv.index("--api") + 1])

    series = temperature()
    pairs = bucket_pairs(series)

    print("HEADLINES")
    for h in [1, 5, 21, 63, 252, 756, 1260]:
        p, n = up_rate(h)
        print(f"up[{h:4d}] = {p:5.1f}%  n={n}")
    day_be = holding(1, 0.0028)[1]
    print(f"daily break-even (stock, 0.28%) = {day_be:.1f}%")
    print(f"annual arithmetic cost: stock={252*.0028*100:.1f}%, ETF={252*.0008*100:.1f}%")

    by_bucket = {b: [] for b in range(5)}
    for j in range(len(series) - 1):
        i, t = series[j]
        k = series[j + 1][0]
        by_bucket[min(int(t // 20), 4)].append(PRICES[k] > PRICES[i])
    print("next-day by temperature:", [round(100 * np.mean(by_bucket[b]), 1) for b in range(5)])

    x, y = nonoverlap(series)
    r = corr(x, y)
    t = r * math.sqrt((len(x) - 2) / (1 - r * r))
    p = 2 * stats.t.sf(abs(t), len(x) - 2)
    print(f"non-overlap r={r:.3f}, n={len(x)}, p={p:.3f}, Bonferroni(5)={min(1,5*p):.3f}")

    wf = walk_forward(series)
    hit = np.mean(wf[:, 0] == wf[:, 1])
    always_up = np.mean(wf[:, 1])
    hit_ci, diff_ci = block_bootstrap_binary(wf)
    print(f"walk-forward n={len(wf)}, hit={100*hit:.1f}%, always-up={100*always_up:.1f}%")
    print(f"  12-month-block CI hit=[{100*hit_ci[0]:.1f}, {100*hit_ci[1]:.1f}]%, difference-vs-always-up=[{100*diff_ci[0]:+.1f}, {100*diff_ci[1]:+.1f}]%p")

    print("\nWARMUP / MA SENSITIVITY (non-overlap offset 0)")
    for ma in [252, 500, 750, 1250, 2000]:
        vals = []
        for warm in [126, 252, 500, 750, 1000, 1250]:
            s = temperature(ma, warm)
            xx, yy = nonoverlap(s)
            vals.append(f"w{warm}:{corr(xx,yy):+.3f}(n={len(xx)})")
        print(f"ma{ma}: " + "  ".join(vals))

    print("\nSTART-DATE SENSITIVITY (same ex-ante series; all daily overlapping pairs)")
    for start in ["1996", "2000", "2005", "2010", "2012", "2015", "2020"]:
        vals = [(b, ret) for (b, ret), (i, _) in zip(pairs, series[:-H]) if DATES[i] >= start]
        meds = [np.median([v for b, v in vals if b == k]) for k in range(5)]
        print(start, "medians", " ".join(f"{v:+6.1f}" for v in meds))

    print("\nNON-OVERLAP OFFSET SENSITIVITY")
    rs = []
    for offset in range(H):
        xx, yy = nonoverlap(series, offset)
        if len(xx) >= 3:
            rs.append(corr(xx, yy))
    print(f"252 possible anchors: min={min(rs):+.3f}, median={np.median(rs):+.3f}, max={max(rs):+.3f}, positive={sum(v>0 for v in rs)}/{len(rs)}")

    print("\n252-DAY MOVING-BLOCK BOOTSTRAP 95% CI")
    ci = moving_block_ci(pairs)
    for b in range(5):
        m = ci[b]["median"]
        q = ci[b]["negative"]
        print(f"{20*b:02d}-{20*(b+1):03d}: median [{m[0]:+.1f}, {m[1]:+.1f}]  loss-rate [{q[0]:.1f}, {q[1]:.1f}]%")

    print("\nPAYOFF-RATIO COUNTEREXAMPLES (cost=0.28% per round trip)")
    for gain, loss in [(0.0107, 0.0109), (0.02, 0.01), (0.03, 0.01), (0.01, 0.02)]:
        be = 100 * (loss + .0028) / (gain + loss)
        print(f"avg gain={100*gain:.2f}%, avg loss={100*loss:.2f}% -> break-even={be:.1f}%")


if __name__ == "__main__":
    sys.exit(main() or 0)
