#!/usr/bin/env python3
"""후행 추세 지표 3종의 독립 재현.

lib/technical-indicators.ts를 보지 않고 같은 정의로 다시 계산해 대조한다.
verify_claims.py와 같은 역할이며, 대상만 기술적 지표다.

    python3 scripts/verify_technical.py
    python3 scripts/verify_technical.py --api http://localhost:3000/api/thermometer

원안은 코덱스. 이식하며 고친 것:
  - 공통 시작점을 1249로 박아두지 않고 정의대로 다시 찾는다.
    (박아두면 데이터 길이가 바뀔 때 조용히 어긋난다)
  - 값 비교를 정확히 같은지가 아니라 허용오차로 바꿨다.
    TS는 Math.round(반올림), 파이썬은 banker's rounding이라
    57.25 같은 경계값에서 57.3 대 57.2로 갈려 헛되이 빨간불이 켜졌다.
  - 설정 상수가 교과서 기본값에서 바뀌지 않았는지 검사한다.
    성적을 보고 창 길이를 조정하는 것이 이 분야의 표준적인 자기기만이다.
  - 겹치는 창의 n과 독립 표본 수를 함께 검사한다.
"""

import json
import math
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "data/market-history.json").read_text())["rows"]
P = [float(r["kospi"]) for r in ROWS]
H = 252
FIVE_YEAR = 1250

# 결과와 무관하게 고정되어야 하는 값. 여기서 벗어나면 실패시킨다.
CANONICAL = {
    "goldenCross": {"short": 50, "long": 200},
    "macd": {"fast": 12, "slow": 26, "signal": 9},
    "bollinger": {"window": 20, "deviations": 2},
}

TOL_VALUE = 0.01    # 가격 수준 값 (지수 포인트)
TOL_OSC = 0.002     # 오실레이터
TOL_RATE = 0.05     # 백분율 — 표시 정밀도(0.1)의 절반


def jsround(x, digits=0):
    """JS의 Math.round(x*m)/m 와 같은 반올림.

    파이썬 기본 round()는 짝수 반올림이라 56.25가 56.2가 되고,
    JS는 floor(x+0.5)라 56.3이 된다. 실제 계산은 같은데 표시에서만
    갈려 CI가 헛되이 빨간불이 켜졌다. 정의를 맞춰 원인을 없앤다.
    """
    m = 10 ** digits
    return math.floor(x * m + 0.5) / m


def sma(values, window):
    out = [None] * len(values)
    total = 0.0
    for i, value in enumerate(values):
        total += value
        if i >= window:
            total -= values[i - window]
        if i >= window - 1:
            out[i] = total / window
    return out


def ema(values, window):
    out = [None] * len(values)
    if len(values) < window:
        return out
    current = sum(values[:window]) / window
    out[window - 1] = current
    alpha = 2 / (window + 1)
    for i in range(window, len(values)):
        current = alpha * values[i] + (1 - alpha) * current
        out[i] = current
    return out


def ema_nullable(values, window):
    out = [None] * len(values)
    first = next((i for i, x in enumerate(values) if x is not None), None)
    if first is None or first + window > len(values):
        return out
    current = sum(values[first:first + window]) / window
    out[first + window - 1] = current
    alpha = 2 / (window + 1)
    for i in range(first + window, len(values)):
        if values[i] is None:
            continue
        current = alpha * values[i] + (1 - alpha) * current
        out[i] = current
    return out


def quantile(values, q):
    values = sorted(values)
    pos = (len(values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] if lo == hi else values[lo] + (values[hi] - values[lo]) * (pos - lo)


def correlation(a, b):
    xs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(xs) < 3:
        return 0.0
    mx = sum(x for x, _ in xs) / len(xs)
    my = sum(y for _, y in xs) / len(xs)
    num = sum((x - mx) * (y - my) for x, y in xs)
    dx = sum((x - mx) ** 2 for x, _ in xs)
    dy = sum((y - my) ** 2 for _, y in xs)
    return 0.0 if dx == 0 or dy == 0 else num / math.sqrt(dx * dy)


def history(states):
    """상태별 1년 뒤 결과. 창이 겹치므로 n은 독립 표본 수가 아니다."""
    groups = {}
    for i in range(len(P) - H):
        if states[i] is None:
            continue
        groups.setdefault(states[i], []).append(100 * (P[i + H] / P[i] - 1))
    return {
        key: {
            "n": len(values),
            "independentN": len(values) // H,
            "medianReturn": jsround(quantile(values, .5), 1),
            "negativeRate": jsround(100 * sum(v < 0 for v in values) / len(values), 1),
        }
        for key, values in groups.items()
    }


def score(oscillator, common_start):
    """창이 겹치지 않게 252거래일씩 건너뛴 방향 적중률과 '항상 상승' 기준선."""
    actual, predicted = [], []
    for i in range(common_start, len(P) - H, H):
        if oscillator[i] is None:
            continue
        actual.append(P[i + H] >= P[i])
        predicted.append(oscillator[i] >= 0)
    if not actual:
        return {"n": 0, "hitRate": 0, "baselineAlwaysUp": 0, "edgeVsBaseline": 0}
    hit = jsround(100 * sum(a == p for a, p in zip(actual, predicted)) / len(actual), 1)
    base = jsround(100 * sum(actual) / len(actual), 1)
    return {"n": len(actual), "hitRate": hit, "baselineAlwaysUp": base,
            "edgeVsBaseline": jsround(hit - base, 1)}


def calculate():
    ma50, ma200 = sma(P, 50), sma(P, 200)
    golden = [None if ma50[i] is None or ma200[i] is None
              else 100 * (ma50[i] - ma200[i]) / ma200[i] for i in range(len(P))]

    fast, slow = ema(P, 12), ema(P, 26)
    macd = [None if fast[i] is None or slow[i] is None else fast[i] - slow[i]
            for i in range(len(P))]
    signal = ema_nullable(macd, 9)
    histogram = [None if macd[i] is None or signal[i] is None else macd[i] - signal[i]
                 for i in range(len(P))]

    middle = sma(P, 20)
    upper, lower, boll = [None] * len(P), [None] * len(P), [None] * len(P)
    boll_states = [None] * len(P)
    for i in range(19, len(P)):
        mean = middle[i]
        sd = math.sqrt(sum((P[j] - mean) ** 2 for j in range(i - 19, i + 1)) / 20)
        upper[i], lower[i] = mean + 2 * sd, mean - 2 * sd
        boll[i] = 0 if sd == 0 else (P[i] - mean) / (2 * sd)
        boll_states[i] = ("above" if P[i] > upper[i] else "below" if P[i] < lower[i]
                          else "upperHalf" if P[i] >= mean else "lowerHalf")

    # 공통 시작점 — 다섯 시리즈가 모두 값을 갖는 첫 날. 상수로 박지 않는다.
    five = sma(P, FIVE_YEAR)
    five_dev = [None if five[i] is None else 100 * (P[i] / five[i] - 1) for i in range(len(P))]
    common = 0
    while common < len(P) and any(s[common] is None for s in (five_dev, golden, histogram, boll)):
        common += 1

    i = len(P) - 1
    position = 100 * (P[i] - lower[i]) / (upper[i] - lower[i])
    return {
        "_commonStart": common,
        "_commonStartDate": ROWS[common]["d"],
        "goldenCross": {
            "settings": {"short": 50, "long": 200},
            "oscillator": jsround(golden[i], 3),
            "overlapWithFiveYearDeviation": jsround(correlation(golden, five_dev), 3),
            "values": {"shortMa": jsround(ma50[i], 2), "longMa": jsround(ma200[i], 2),
                       "spreadPct": jsround(golden[i], 2)},
            "history": history([None if x is None else "above" if x >= 0 else "below"
                                for x in golden]),
            "fairScore": score(golden, common),
        },
        "macd": {
            "settings": {"fast": 12, "slow": 26, "signal": 9},
            "oscillator": jsround(histogram[i], 3),
            "overlapWithFiveYearDeviation": jsround(correlation(histogram, five_dev), 3),
            "values": {"macd": jsround(macd[i], 2), "signal": jsround(signal[i], 2),
                       "histogram": jsround(histogram[i], 2)},
            "history": history([None if x is None else "bullish" if x >= 0 else "bearish"
                                for x in histogram]),
            "fairScore": score(histogram, common),
        },
        "bollinger": {
            "settings": {"window": 20, "deviations": 2},
            "oscillator": jsround(boll[i], 3),
            "overlapWithFiveYearDeviation": jsround(correlation(boll, five_dev), 3),
            "values": {"middle": jsround(middle[i], 2), "upper": jsround(upper[i], 2),
                       "lower": jsround(lower[i], 2), "positionPct": jsround(position, 2)},
            "history": history(boll_states),
            "fairScore": score(boll, common),
        },
    }


def near(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def compare(url, mine):
    with urllib.request.urlopen(url, timeout=180) as response:
        api = json.loads(response.read().decode()).get("technicalSignals")
    if not api:
        print("FAIL\n  API 응답에 technicalSignals가 없습니다.")
        return 1
    theirs = {s["key"]: s for s in api["signals"]}
    failures, checks = [], 0

    for key in ("goldenCross", "macd", "bollinger"):
        expected = mine[key]
        actual = theirs.get(key)
        if actual is None:
            failures.append(f"{key}: 응답에 없음")
            continue

        # 설정이 교과서 기본값에서 바뀌지 않았는가 (성적 보고 튜닝 방지)
        checks += 1
        if actual["settings"] != CANONICAL[key]:
            failures.append(f"{key}.settings: {actual['settings']} != {CANONICAL[key]} (임의 변경 의심)")

        for name, value in expected["values"].items():
            checks += 1
            if not near(actual["values"].get(name), value, TOL_VALUE):
                failures.append(f"{key}.values.{name}: {actual['values'].get(name)} != {value}")

        checks += 1
        if not near(actual.get("oscillator"), expected["oscillator"], TOL_OSC):
            failures.append(f"{key}.oscillator: {actual.get('oscillator')} != {expected['oscillator']}")

        checks += 1
        if not near(actual.get("overlapWithFiveYearDeviation"),
                    expected["overlapWithFiveYearDeviation"], 0.002):
            failures.append(f"{key}.overlap: {actual.get('overlapWithFiveYearDeviation')} "
                            f"!= {expected['overlapWithFiveYearDeviation']}")

        af = actual.get("fairScore", {})
        for name, value in expected["fairScore"].items():
            checks += 1
            tol = 0 if name == "n" else TOL_RATE
            if not near(af.get(name), value, tol):
                failures.append(f"{key}.fairScore.{name}: {af.get(name)} != {value}")
        # 기준선을 함께 보고 있는가 — 적중률만 자랑하는 퇴행을 막는다
        checks += 1
        if "baselineAlwaysUp" not in af or "edgeVsBaseline" not in af:
            failures.append(f"{key}.fairScore: 항상 상승 기준선이 빠졌습니다")

        actual_history = {h["key"]: h for h in actual["history"]}
        for state, values in expected["history"].items():
            got = actual_history.get(state)
            if got is None:
                failures.append(f"{key}.history.{state}: 응답에 없음")
                continue
            for name, value in values.items():
                checks += 1
                tol = 0 if name in ("n", "independentN") else TOL_RATE
                if not near(got.get(name), value, tol):
                    failures.append(f"{key}.history.{state}.{name}: {got.get(name)} != {value}")

    if failures:
        print(f"FAIL  ({len(failures)} / {checks}건)")
        print("\n".join("  " + f for f in failures))
        return 1
    print(f"PASS  {checks}개 항목이 독립 재계산과 일치합니다.")
    print(f"      설정 상수 고정, 항상 상승 기준선 존재, 겹침 보정 표본 수 포함.")
    print(f"      공통 평가 시작: {mine['_commonStartDate']} (index {mine['_commonStart']})")
    return 0


def report(mine):
    print(f"후행 추세 지표 — 1년 뒤 결과  (공통 평가 시작 {mine['_commonStartDate']})\n")
    for key, label in (("goldenCross", "골든크로스 50/200"), ("macd", "MACD 12/26/9"),
                       ("bollinger", "볼린저 20/2σ")):
        d = mine[key]
        f = d["fairScore"]
        print(f"  {label}")
        print(f"    5년 이격도와 겹침  상관 {d['overlapWithFiveYearDeviation']:+.3f}")
        print(f"    방향 적중률        {f['hitRate']:.1f}%  "
              f"항상 상승 {f['baselineAlwaysUp']:.1f}%  "
              f"차이 {f['edgeVsBaseline']:+.1f}%p  (독립 표본 {f['n']}개)")
        for state, v in d["history"].items():
            print(f"    {state:<10} 중앙값 {v['medianReturn']:+5.1f}%  "
                  f"손실 {v['negativeRate']:4.1f}%  "
                  f"겹친 n {v['n']:,} (독립 {v['independentN']})")
        print()
    print("  주의: 독립 표본이 30개대다. 차이 몇 %p는 한두 해가 바뀌면 뒤집힌다.")


if __name__ == "__main__":
    result = calculate()
    if "--api" in sys.argv:
        raise SystemExit(compare(sys.argv[sys.argv.index("--api") + 1], result))
    if "--json" in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        report(result)
