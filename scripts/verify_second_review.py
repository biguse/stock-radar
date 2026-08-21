#!/usr/bin/env python3
"""Second-round adversarial checks for VERIFY.md.

This script is intentionally separate from the production TypeScript.  It
reuses only the first-review Python reconstruction of the temperature series,
then probes bootstrap tuning/Monte-Carlo error and candidate-selection bias.

    python3 scripts/verify_second_review.py
"""

import importlib.util
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_v1", ROOT / "scripts/verify_claims.py")
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)


def mulberry32(seed):
    """Bit-for-bit equivalent of lib/thermometer.ts's PRNG."""
    mask = 0xFFFFFFFF
    state = seed & mask
    while True:
        state = (state + 0x6D2B79F5) & mask
        t = ((state ^ (state >> 15)) * (1 | state)) & mask
        old_t = t
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & mask)) & mask) ^ old_t
        yield ((t ^ (t >> 14)) & mask) / 4294967296


def bootstrap(pairs, block, reps, seed):
    """Circular moving-block bootstrap, matching bucketBootstrap's design."""
    rng = mulberry32(seed)
    buckets = np.asarray([b for b, _ in pairs], dtype=np.int8)
    returns = np.asarray([r for _, r in pairs], dtype=float)
    n = len(pairs)
    meds = [[] for _ in range(5)]
    negs = [[] for _ in range(5)]
    offsets = np.arange(block)
    blocks_needed = (n + block - 1) // block
    for _ in range(reps):
        starts = np.fromiter((int(next(rng) * n) for _ in range(blocks_needed)), dtype=int)
        idx = ((starts[:, None] + offsets) % n).ravel()[:n]
        bb, rr = buckets[idx], returns[idx]
        for b in range(5):
            values = rr[bb == b]
            if len(values) < 20:  # matches production's replicate-level guard
                continue
            meds[b].append(float(np.median(values)))
            negs[b].append(float(100 * np.mean(values < 0)))
    return [
        (*np.percentile(meds[b], [2.5, 97.5]), *np.percentile(negs[b], [2.5, 97.5]))
        for b in range(5)
    ]


def candidate_scores():
    """Rebuild the five candidates from app/api/analysis/route.ts."""
    rows, prices, n, ma = v1.ROWS, v1.PRICES, len(v1.ROWS), 1250
    cs = np.r_[0.0, np.cumsum(prices)]
    dev = [None] * n
    for i in range(ma - 1, n):
        dev[i] = 100 * (prices[i] / ((cs[i + 1] - cs[i + 1 - ma]) / ma) - 1)
    per = [r.get("per") for r in rows]
    pbr = [r.get("pbr") for r in rows]
    earnings = [prices[i] / per[i] if per[i] and per[i] > 0 else None for i in range(n)]
    cape = [None] * n
    total, count = 0.0, 0
    for i, value in enumerate(earnings):
        if value is not None:
            total += value
            count += 1
        if i >= ma and earnings[i - ma] is not None:
            total -= earnings[i - ma]
            count -= 1
        if i >= ma - 1 and count > ma * 0.6:
            cape[i] = prices[i] / (total / count)
    erp = [
        100 / per[i] - rows[i]["kr10y"]
        if per[i] and per[i] > 0 and rows[i].get("kr10y") is not None
        else None
        for i in range(n)
    ]
    raw = {"dev": dev, "per": per, "pbr": pbr, "cape": cape, "erp": erp}
    scores = {k: v1.percentile_series(values, 750) for k, values in raw.items()}
    scores["erp"] = [None if x is None else 100 - x for x in scores["erp"]]
    return scores


def correlations_on_common_window(scores, start, end):
    """One common calendar and common anchors; avoids comparing unlike eras."""
    inds = list(range(start, end - 252, 252))
    returns = np.asarray([100 * (v1.PRICES[i + 252] / v1.PRICES[i] - 1) for i in inds])
    return {
        key: float(np.corrcoef([values[i] for i in inds], returns)[0, 1])
        for key, values in scores.items()
    }, len(inds)


def main():
    series = v1.temperature()
    pairs = v1.bucket_pairs(series)

    print("BLOCK-LENGTH SENSITIVITY (10,000 reps; median CI | loss-rate CI)")
    for block in (126, 252, 504):
        result = bootstrap(pairs, block, 10_000, 20260822)
        print(f"block={block}")
        for b, (ml, mh, nl, nh) in enumerate(result):
            print(f"  {20*b:02d}-{20*(b+1):03d}: [{ml:+5.1f},{mh:+5.1f}] | [{nl:4.1f},{nh:4.1f}]%")

    print("\n400-REP MONTE-CARLO ERROR ACROSS 100 FIXED SEEDS")
    endpoints = []
    signs = []
    for seed in range(1000, 1100):
        result = bootstrap(pairs, 252, 400, seed)
        endpoints.append(np.asarray(result))
        signs.append([lo > 0 or hi < 0 for lo, hi, _, _ in result])
    endpoints = np.asarray(endpoints)
    signs = np.asarray(signs)
    for b in range(5):
        # Range across seeds is the reproducibility question users actually face.
        ranges = [(endpoints[:, b, j].min(), endpoints[:, b, j].max()) for j in range(4)]
        print(f"  {20*b:02d}-{20*(b+1):03d}: endpoint seed-ranges={ranges}; sign-certain={signs[:,b].mean()*100:.0f}%")

    print("\nCANDIDATE SELECTION ON A COMMON CALENDAR")
    scores = candidate_scores()
    first = {k: next(i for i, x in enumerate(values) if x is not None) for k, values in scores.items()}
    common = max(first.values())
    full, full_n = correlations_on_common_window(scores, common, len(v1.ROWS))
    print("  first-valid:", {k: v1.ROWS[i]["d"] for k, i in first.items()})
    print(f"  common start={v1.ROWS[common]['d']}, n={full_n}:", {k: round(x, 3) for k, x in full.items()})
    split = next(i for i, r in enumerate(v1.ROWS) if r["d"] >= "2012-01-01")
    train, train_n = correlations_on_common_window(scores, common, split)
    test, test_n = correlations_on_common_window(scores, split, len(v1.ROWS))
    chosen = min(train, key=train.get)
    print(f"  train through 2011 n={train_n}: selected={chosen}, r={train[chosen]:+.3f}")
    print(f"  untouched 2012+ n={test_n}: selected candidate r={test[chosen]:+.3f}; all={{{', '.join(f'{k}: {x:+.3f}' for k,x in test.items())}}}")

    print("\nAPI-CHECK COVERAGE AUDIT (2차 지적 반영 후)")
    src = (ROOT / "scripts/verify_claims.py").read_text(encoding="utf-8")
    expected = {
        "bucketCI": "부트스트랩 구간",
        "dividend": "배당수익률 평균",
        "payoff": "손익분기",
        "scorecard.n": "워크포워드 평가횟수",
        "myBucket": "오늘 구간",
    }
    missing = [label for key, label in expected.items() if label not in src]
    print("  검사 대상에 포함된 새 주장:",
          [label for key, label in expected.items() if label in src])
    if missing:
        print("  아직 검사되지 않는 주장:", missing)
    else:
        print("  2차에서 지적한 미검사 항목은 모두 검사 대상에 편입됨")
    for tol, name in [("TOL_RATE, TOL_CORR, TOL_COUNT = 0.05, 0.0005, 0", "허용오차")]:
        print(f"  {name}: {'표시 정밀도보다 작음 (통과)' if tol in src else '느슨함 (확인 필요)'}")
    print("  주의: 두 구현이 같은 market-history.json을 읽으므로 원자료가 틀리면")
    print("        완벽히 일치하며 통과한다. 데이터 정확성은 verify-price-lineage.py 담당.")


if __name__ == "__main__":
    main()
