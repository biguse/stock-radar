#!/usr/bin/env python3
"""원자료 무결성 게이트 — 체크인된 데이터가 예고 없이 바뀌는 것을 잡는다.

verify_claims.py와 verify_technical.py는 둘 다 data/market-history.json을
읽는다. 두 구현이 서로 대조되므로 계산 실수는 잡히지만, **원자료가 틀리면
둘 다 사이좋게 틀린 답에 합의한다.** 실제로 2000-05-01 한 행이 KRX에
없는 값인 채로 두 검증을 모두 통과한 적이 있다.

그래서 이 검사는 계산을 보지 않는다. 파일 자체만 본다.

  python3 scripts/verify_data_integrity.py
  python3 scripts/verify_data_integrity.py --json
  python3 scripts/verify_data_integrity.py --against HEAD~1
  python3 scripts/verify_data_integrity.py --update-manifest

이 검사가 하지 않는 일: 네이버나 KRX의 값이 옳은지는 판단하지 않는다.
그것은 scripts/verify-price-lineage.py(주간 KRX 대조)의 몫이다.
여기서 묻는 것은 "어제와 달라진 데가 있는가, 있다면 설명이 있는가"뿐이다.
"""

import argparse
import datetime as dt
import hashlib
import json
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/market-history.json"
MANIFEST = ROOT / "data/market-history.manifest.json"

# 오류로 볼 것 — 어떤 경우에도 성립해야 하는 것들
REQUIRED_FIELDS = ["d", "kospi"]
# 결측 현황을 보고할 것 (결측 자체는 오류가 아니다. FRED·KRX는 갱신이 늦다)
TRACKED_FIELDS = ["kospi", "vix", "fx", "y10", "spread", "expYoY", "per", "pbr", "kr10y", "dy"]

# ── 경고 임계치 ────────────────────────────────────────────────────
# 실제 분포를 보고 정했다. 임계치를 넘는다고 틀린 데이터라는 뜻은 아니며,
# 사람이 한 번 봐야 한다는 신호다. 오류가 아니므로 종료코드를 바꾸지 않는다.
#
#  공백: 관측된 최대는 11일(2017-09-29→10-10, 추석+개천절+한글날).
#        8일 이상은 3건뿐이라 여기를 경계로 잡았다.
#  등락: |10%| 이상이 36년간 7건. 1998·2008·2020년의 실제 폭락일이다.
#  변동성: 연도별 일간 표준편차가 전체 연도 중앙값의 2.5배를 넘는 해.
#        IMF(1998, 2.2배)·닷컴(2000, 2.2배)·금융위기(2008, 1.9배)·
#        코로나(2020, 1.4배)가 걸리지 않는 선으로 잡았다. 즉 이 경고는
#        "역사상 최악의 해보다도 심하다"는 뜻이지 변동성이 크다는 뜻이 아니다.
GAP_WARN_DAYS = 8
MOVE_WARN_PCT = 10.0
VOL_WARN_RATIO = 2.5
VOL_MIN_DAYS = 60  # 연초라 일수가 적으면 표준편차가 불안정하다


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def row_hash(row) -> str:
    """행 하나의 내용 해시. 키 순서와 공백에 흔들리지 않게 정규화한다."""
    canon = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def approval_matches(entry, change_type, before, after):
    """승인 항목이 이 변경과 정확히 일치하는지.

    날짜만 맞으면 통과시키면, 한 번 승인된 날짜는 앞으로 그 날짜에
    무슨 짓을 해도 영원히 통과한다. 그래서 종류와 내용까지 본다.

    돌려주는 값: (일치 여부, 어긋난 이유)
    """
    if entry.get("changeType") != change_type:
        return False, (f"기록된 changeType은 '{entry.get('changeType')}'인데 "
                       f"실제 변경은 '{change_type}'입니다")
    if not str(entry.get("reason", "")).strip():
        return False, "reason이 비어 있습니다"

    need_before = change_type in ("removed", "modified")
    need_after = change_type in ("inserted", "modified")

    if need_before:
        want = entry.get("beforeHash")
        if not want:
            return False, "beforeHash가 없습니다"
        got = row_hash(before) if before is not None else None
        if got != want:
            return False, f"변경 전 행이 승인된 내용과 다릅니다 (기대 {want[:12]}…, 실제 {str(got)[:12]}…)"
    if need_after:
        want = entry.get("afterHash")
        if not want:
            return False, "afterHash가 없습니다"
        got = row_hash(after) if after is not None else None
        if got != want:
            return False, f"변경 후 행이 승인된 내용과 다릅니다 (기대 {want[:12]}…, 실제 {str(got)[:12]}…)"
    return True, None


def git(*args, cwd=ROOT):
    try:
        out = subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True)
        return out.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def load_rows(raw: bytes):
    return json.loads(raw.decode("utf-8"))["rows"]


# ── 파일 자체 검사 ──────────────────────────────────────────────────

def check_shape(rows, errors, warnings):
    seen = {}
    prev = None
    for i, r in enumerate(rows):
        d = r.get("d")
        if not isinstance(d, str) or len(d) != 10:
            errors.append(f"[형식] index {i}: 날짜가 YYYY-MM-DD가 아닙니다 ({d!r})")
            continue
        try:
            dt.date.fromisoformat(d)
        except ValueError:
            errors.append(f"[형식] index {i}: 존재하지 않는 날짜입니다 ({d})")
            continue
        if d in seen:
            errors.append(f"[중복] {d} 가 index {seen[d]} 와 {i} 에 두 번 있습니다")
        else:
            seen[d] = i
        if prev is not None and d <= prev:
            errors.append(f"[순서] index {i}: {d} 가 앞 행 {prev} 보다 뒤가 아닙니다")
        prev = d

    for f in REQUIRED_FIELDS:
        for r in rows:
            if r.get(f) is None:
                errors.append(f"[결측] {r.get('d')}: 필수 항목 {f} 가 비어 있습니다")

    for r in rows:
        v = r.get("kospi")
        if v is None:
            continue
        if not isinstance(v, (int, float)):
            errors.append(f"[형식] {r['d']}: kospi 가 숫자가 아닙니다 ({v!r})")
        elif v <= 0:
            errors.append(f"[값] {r['d']}: kospi 가 {v} 입니다 (0 이하)")


def field_coverage(rows):
    out = {}
    for f in TRACKED_FIELDS:
        valid = [r["d"] for r in rows if r.get(f) is not None]
        out[f] = {
            "nullCount": len(rows) - len(valid),
            "firstValid": valid[0] if valid else None,
            "lastValid": valid[-1] if valid else None,
        }
    return out


def find_gaps(rows):
    out = []
    for a, b in zip(rows, rows[1:]):
        try:
            gap = (dt.date.fromisoformat(b["d"]) - dt.date.fromisoformat(a["d"])).days
        except (ValueError, TypeError, KeyError):
            continue
        if gap >= GAP_WARN_DAYS:
            out.append({"from": a["d"], "to": b["d"], "days": gap})
    return out


def find_moves(rows):
    out = []
    for a, b in zip(rows, rows[1:]):
        pa, pb = a.get("kospi"), b.get("kospi")
        if not pa or not pb:
            continue
        pct = (pb / pa - 1) * 100
        if abs(pct) >= MOVE_WARN_PCT:
            out.append({"date": b["d"], "changePct": round(pct, 2),
                        "from": pa, "to": pb})
    return out


def yearly_volatility(rows):
    by = {}
    for a, b in zip(rows, rows[1:]):
        pa, pb = a.get("kospi"), b.get("kospi")
        if not pa or not pb:
            continue
        by.setdefault(b["d"][:4], []).append((pb / pa - 1) * 100)
    stats = {}
    for year, moves in by.items():
        prices = [r["kospi"] for r in rows if r["d"][:4] == year and r.get("kospi")]
        stats[year] = {
            "days": len(moves),
            "dailySd": round(statistics.pstdev(moves), 2) if len(moves) > 1 else 0.0,
            "low": round(min(prices), 2) if prices else None,
            "high": round(max(prices), 2) if prices else None,
        }
    solid = [s["dailySd"] for s in stats.values() if s["days"] >= VOL_MIN_DAYS and s["dailySd"] > 0]
    median = statistics.median(solid) if solid else 0.0
    outliers = []
    for year, s in sorted(stats.items()):
        if median > 0 and s["days"] >= VOL_MIN_DAYS and s["dailySd"] >= median * VOL_WARN_RATIO:
            outliers.append({**s, "year": year, "ratio": round(s["dailySd"] / median, 2)})
    return {"medianDailySd": round(median, 2), "byYear": stats, "outliers": outliers}


# ── 이전 상태와의 대조 ──────────────────────────────────────────────

def resolve_baseline(against):
    """비교 기준을 정한다.

    명시하지 않으면 워킹트리가 HEAD와 다를 때는 HEAD를,
    같을 때는 HEAD~1을 쓴다. 후자는 CI에서 방금 push된 커밋을
    직전 커밋과 대조하기 위한 것이다.
    """
    rel = str(DATA.relative_to(ROOT))
    if against:
        raw = git("show", f"{against}:{rel}")
        return (against, raw) if raw else (against, None)
    dirty = git("diff", "--quiet", "HEAD", "--", rel) is None
    rev = "HEAD" if dirty else "HEAD~1"
    return rev, git("show", f"{rev}:{rel}")


def diff_rows(base_rows, cur_rows):
    base = {r["d"]: r for r in base_rows if isinstance(r.get("d"), str)}
    cur = {r["d"]: r for r in cur_rows if isinstance(r.get("d"), str)}
    added = sorted(set(cur) - set(base))
    removed = sorted(set(base) - set(cur))
    modified = []
    for d in sorted(set(base) & set(cur)):
        if base[d] != cur[d]:
            changed = sorted(
                k for k in set(base[d]) | set(cur[d]) if base[d].get(k) != cur[d].get(k)
            )
            modified.append({"date": d, "fields": changed,
                             "beforeRow": base[d], "afterRow": cur[d],
                             "before": {k: base[d].get(k) for k in changed},
                             "after": {k: cur[d].get(k) for k in changed}})
    return added, removed, modified, base, cur


def check_against_baseline(base_rows, cur_rows, manifest, errors, warnings, info):
    added, removed, modified, base_map, cur_map = diff_rows(base_rows, cur_rows)
    base_last = max((r["d"] for r in base_rows if isinstance(r.get("d"), str)), default="")

    # 최신 날짜 추가는 정상적인 증분이다.
    appended = [d for d in added if d > base_last]
    back_inserted = [d for d in added if d <= base_last]

    # 같은 날짜에 여러 승인이 있을 수 있으므로 목록으로 모은다.
    approved = {}
    for c in manifest.get("intentionalChanges", []):
        if isinstance(c, dict) and c.get("date"):
            approved.setdefault(c["date"], []).append(c)

    info["diff"] = {
        "baselineLastDate": base_last,
        "appended": appended,
        "backInserted": back_inserted,
        "removed": removed,
        "modified": [m["date"] for m in modified],
    }

    def demand(date, change_type, before, after, detail):
        entries = approved.get(date, [])
        if not entries:
            errors.append(
                f"[미승인 변경] {date} 가 {change_type} 되었는데 manifest의 "
                f"intentionalChanges에 항목이 없습니다. {detail}"
            )
            return
        reasons = []
        for entry in entries:
            ok, why = approval_matches(entry, change_type, before, after)
            if ok:
                info.setdefault("approvedApplied", []).append(
                    {"date": date, "changeType": change_type, "reason": entry.get("reason")}
                )
                return
            reasons.append(why)
        errors.append(
            f"[미승인 변경] {date} 의 {change_type} 가 승인 항목과 맞지 않습니다. "
            f"{detail} — " + " / ".join(reasons)
        )

    for d in removed:
        demand(d, "removed", base_map[d], None, "과거 행이 사라졌습니다.")
    for m in modified:
        demand(m["date"], "modified", m["beforeRow"], m["afterRow"],
               f"바뀐 항목: {', '.join(m['fields'])}")
    for d in back_inserted:
        demand(d, "inserted", None, cur_map[d],
               f"마지막 날짜({base_last})보다 과거인데 새로 생겼습니다.")

    if appended:
        info["appendedSummary"] = f"{len(appended)}행 추가 ({appended[0]} ~ {appended[-1]})"
    return {"removed": removed, "modified": modified, "backInserted": back_inserted,
            "appended": appended, "baseMap": base_map, "curMap": cur_map}


def check_manifest(manifest, rows, digest, errors, warnings, info):
    if not manifest:
        errors.append(
            "[매니페스트] data/market-history.manifest.json 이 없습니다. "
            "--update-manifest 로 생성하세요."
        )
        return
    actual = {"rowCount": len(rows), "firstDate": rows[0]["d"] if rows else None,
              "lastDate": rows[-1]["d"] if rows else None, "sha256": digest}
    drift = {k: {"manifest": manifest.get(k), "actual": v}
             for k, v in actual.items() if manifest.get(k) != v}
    info["manifestDrift"] = drift
    if drift:
        # 매일 한 행씩 늘어나므로 드리프트 자체는 정상이다.
        # 과거 구간 변경 여부는 위의 커밋 대조가 판정한다.
        warnings.append(
            "매니페스트가 현재 파일과 다릅니다 (" + ", ".join(sorted(drift)) + "). "
            "정상 증분이라면 --update-manifest 로 갱신하세요."
        )


def build_manifest(rows, digest, previous):
    src = json.loads(DATA.read_text(encoding="utf-8"))
    keep = previous.get("intentionalChanges", []) if previous else []
    return {
        "rowCount": len(rows),
        "firstDate": rows[0]["d"] if rows else None,
        "lastDate": rows[-1]["d"] if rows else None,
        "sha256": digest,
        "source": src.get("source"),
        "generatedAt": dt.date.today().isoformat(),
        "note": (
            "체크인된 원자료의 승인된 상태. 과거 행을 고치거나 지울 때는 "
            "--approve 로 승인 항목을 남겨야 통과한다. 승인은 날짜뿐 아니라 "
            "changeType과 변경 전/후 행 해시까지 일치해야 유효하다 — 날짜만 보면 "
            "한 번 승인된 날짜가 앞으로 어떤 변경이든 통과시키기 때문이다. "
            "최신 날짜 추가는 승인 없이 통과한다."
        ),
        "intentionalChanges": keep,
    }


def approve(args, rows, digest, manifest):
    """지금 눈에 보이는 과거 변경을 승인 항목으로 기록한다.

    사람이 해시를 손으로 적을 수는 없으므로, 실제 변경을 읽어
    changeType과 before/after 해시를 함께 남긴다.
    """
    if not manifest:
        print("매니페스트가 없습니다. 먼저 --update-manifest 로 만드세요.", file=sys.stderr)
        return 1
    rev, base_raw = resolve_baseline(args.against)
    if base_raw is None:
        print(f"{rev} 의 데이터 파일을 읽을 수 없어 승인할 수 없습니다.", file=sys.stderr)
        return 1
    added, removed, modified, base_map, cur_map = diff_rows(load_rows(base_raw), rows)
    base_last = max(base_map, default="")
    back_inserted = [d for d in added if d <= base_last]

    entries = []
    for d in removed:
        entries.append({"date": d, "changeType": "removed",
                        "beforeHash": row_hash(base_map[d]), "before": base_map[d]})
    for m in modified:
        entries.append({"date": m["date"], "changeType": "modified",
                        "beforeHash": row_hash(m["beforeRow"]),
                        "afterHash": row_hash(m["afterRow"]),
                        "changedFields": m["fields"],
                        "before": m["before"], "after": m["after"]})
    for d in back_inserted:
        entries.append({"date": d, "changeType": "inserted",
                        "afterHash": row_hash(cur_map[d]), "after": cur_map[d]})

    if not entries:
        print(f"{rev} 대비 승인할 과거 변경이 없습니다.")
        return 0

    stamp = dt.date.today().isoformat()
    for e in entries:
        e["reason"] = args.approve
        e["approvedAt"] = stamp
        if args.evidence:
            e["evidence"] = args.evidence

    manifest.setdefault("intentionalChanges", []).extend(entries)
    manifest["rowCount"] = len(rows)
    manifest["firstDate"] = rows[0]["d"] if rows else None
    manifest["lastDate"] = rows[-1]["d"] if rows else None
    manifest["sha256"] = digest
    manifest["generatedAt"] = stamp
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(f"{len(entries)}건을 승인 항목으로 기록했습니다 ({rev} 대비)")
    for e in entries:
        print(f"  {e['date']}  {e['changeType']}"
              + (f"  before {e['beforeHash'][:12]}…" if e.get("beforeHash") else "")
              + (f"  after {e['afterHash'][:12]}…" if e.get("afterHash") else ""))
    print(f"  사유: {args.approve}")
    return 0


def run(args):
    errors, warnings, info = [], [], {}
    raw = DATA.read_bytes()
    rows = load_rows(raw)
    digest = sha256(DATA)

    info["file"] = {
        "path": str(DATA.relative_to(ROOT)),
        "rowCount": len(rows),
        "firstDate": rows[0]["d"] if rows else None,
        "lastDate": rows[-1]["d"] if rows else None,
        "sha256": digest,
    }

    check_shape(rows, errors, warnings)
    info["fields"] = field_coverage(rows)
    info["gaps"] = find_gaps(rows)
    info["moves"] = find_moves(rows)
    info["volatility"] = yearly_volatility(rows)

    for g in info["gaps"]:
        warnings.append(f"{g['from']} → {g['to']} 사이가 {g['days']}일 비었습니다")
    for m in info["moves"]:
        warnings.append(f"{m['date']}: 하루 {m['changePct']:+.2f}% 움직였습니다")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else None

    # 이미 KRX 공식값과 대조가 끝난 구간은 그 사실을 함께 알린다.
    # 경고는 지우지 않는다 — 지우면 다음 사람이 왜 조용한지 알 수 없다.
    # 대신 같은 조사를 되풀이하지 않도록 결론을 붙인다.
    verified = {}
    for v in (manifest or {}).get("verifications", []):
        if isinstance(v, dict) and v.get("scope"):
            verified[str(v["scope"])] = v
    info["verifications"] = list(verified)

    for o in info["volatility"]["outliers"]:
        base = (f"{o['year']}년 일간 변동성이 다른 해 중앙값의 {o['ratio']}배입니다 "
                f"(표준편차 {o['dailySd']}, {o['days']}일, 종가 {o['low']:,.0f}~{o['high']:,.0f})")
        v = verified.get(o["year"])
        if v:
            o["verified"] = True
            warnings.append(
                base + f". 다만 이 구간은 KRX 공식 시세와 대조가 끝났습니다 — "
                f"{v['period']['from']}~{v['period']['to']} 공통 {v['commonDays']}일, "
                f"불일치 {v['mismatches']}건 (run {v['actionsRunId']}). "
                f"수집 오류가 아니므로 다시 조사할 필요가 없습니다"
            )
        else:
            o["verified"] = False
            warnings.append(base + ". 원자료 구간 오류일 수 있습니다 — "
                            "KRX 대조가 필요합니다 (krx-audit 워크플로)")

    if args.update_manifest:
        if errors:
            print("매니페스트를 갱신하지 않았습니다 — 먼저 오류를 해결하세요.", file=sys.stderr)
            for e in errors:
                print("  " + e, file=sys.stderr)
            return 1
        MANIFEST.write_text(
            json.dumps(build_manifest(rows, digest, manifest), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        print(f"갱신했습니다: {MANIFEST.relative_to(ROOT)}")
        print(f"  {len(rows):,}행  {rows[0]['d']} ~ {rows[-1]['d']}  sha256 {digest[:16]}…")
        return 0

    if args.approve:
        if errors:
            print("승인을 기록하지 않았습니다 — 먼저 오류를 해결하세요.", file=sys.stderr)
            for e in errors:
                print("  " + e, file=sys.stderr)
            return 1
        return approve(args, rows, digest, manifest)

    check_manifest(manifest, rows, digest, errors, warnings, info)

    rev, base_raw = resolve_baseline(args.against)
    if base_raw is None:
        warnings.append(f"{rev} 의 데이터 파일을 읽을 수 없어 커밋 대조를 건너뜁니다")
        info["baseline"] = {"rev": rev, "available": False}
    else:
        info["baseline"] = {"rev": rev, "available": True}
        check_against_baseline(load_rows(base_raw), rows, manifest or {}, errors, warnings, info)

    info["errors"] = errors
    info["warnings"] = warnings
    return report(info, errors, warnings, args)


def report(info, errors, warnings, args):
    if args.json:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 1 if errors else 0

    f = info["file"]
    print("원자료 무결성 — data/market-history.json")
    print(f"  {f['rowCount']:,}행   {f['firstDate']} ~ {f['lastDate']}")
    print(f"  sha256 {f['sha256']}")
    b = info.get("baseline", {})
    print(f"  대조 기준 {b.get('rev')}" + ("" if b.get("available") else " (읽을 수 없음)"))

    d = info.get("diff")
    if d:
        print("\n이전 상태와의 차이")
        print(f"  최신 추가   {len(d['appended'])}행"
              + (f"  ({d['appended'][0]} ~ {d['appended'][-1]})" if d["appended"] else ""))
        print(f"  과거 삽입   {len(d['backInserted'])}행 {d['backInserted'] or ''}")
        print(f"  삭제        {len(d['removed'])}행 {d['removed'] or ''}")
        print(f"  수정        {len(d['modified'])}행 {d['modified'] or ''}")
        for a in info.get("approvedApplied", []):
            print(f"  승인됨 · {a['date']} {a['changeType']} — {a['reason']}")

    print("\n항목별 결측")
    for name, s in info["fields"].items():
        print(f"  {name:<8} null {s['nullCount']:>5}   유효 {s['firstValid']} ~ {s['lastValid']}")

    v = info["volatility"]
    print(f"\n연도별 일간 변동성 — 중앙값 {v['medianDailySd']}")
    if v["outliers"]:
        for o in v["outliers"]:
            mark = "✓ KRX 대조 완료" if o.get("verified") else "⚠ 미대조"
            print(f"  {'⚠' if not o.get('verified') else '·'} {o['year']}  "
                  f"표준편차 {o['dailySd']}  중앙값의 {o['ratio']}배  "
                  f"{o['days']}일  종가 {o['low']:,.0f}~{o['high']:,.0f}   {mark}")
    else:
        print("  중앙값의 2.5배를 넘는 해가 없습니다")

    if warnings:
        print(f"\n경고 {len(warnings)}건 (종료코드를 바꾸지 않습니다)")
        for w in warnings:
            print(f"  · {w}")

    if errors:
        print(f"\nFAIL — 오류 {len(errors)}건")
        for e in errors:
            print(f"  · {e}")
        return 1
    print("\nPASS — 순서·중복·필수값 이상 없음, 과거 구간 무단 변경 없음")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="원자료 무결성 게이트")
    p.add_argument("--json", action="store_true", help="결과를 JSON으로 출력")
    p.add_argument("--against", metavar="REV", help="대조할 git 리비전 (기본: HEAD 또는 HEAD~1)")
    p.add_argument("--update-manifest", action="store_true",
                   help="현재 파일 상태로 매니페스트를 갱신 (오류가 없을 때만)")
    p.add_argument("--approve", metavar="사유",
                   help="지금 보이는 과거 변경을 승인 항목으로 기록 (해시까지 함께 남긴다)")
    p.add_argument("--evidence", metavar="경로", help="--approve 와 함께 쓸 근거 자료")
    raise SystemExit(run(p.parse_args()))
