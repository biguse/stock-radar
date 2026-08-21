#!/usr/bin/env python3
"""verify_data_integrity.py 의 자체 시험.

게이트가 실제로 물리는지 확인한다. 통과만 시켜보는 시험은
게이트가 통째로 꺼져 있어도 초록불이 켜지므로 의미가 없다.
그래서 일곱 경우 중 넷은 **반드시 실패해야** 통과로 친다.

진짜 데이터는 건드리지 않는다. 임시 디렉터리에 작은 저장소를
새로 만들어 그 안에서만 조작한다.

    python3 scripts/test_data_integrity.py
"""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "verify_data_integrity.py"

BASE_ROWS = [
    {"d": "2026-08-03", "kospi": 6257.45, "vix": 16.0, "fx": 1390.0,
     "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.5, "pbr": 1.9,
     "kr10y": None, "dy": 0.93},
    {"d": "2026-08-04", "kospi": 6358.95, "vix": 15.8, "fx": 1391.0,
     "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.6, "pbr": 1.9,
     "kr10y": None, "dy": 0.93},
    {"d": "2026-08-05", "kospi": 6598.26, "vix": 15.5, "fx": 1392.0,
     "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.7, "pbr": 1.95,
     "kr10y": None, "dy": 0.92},
    {"d": "2026-08-06", "kospi": 6601.10, "vix": 15.6, "fx": 1393.0,
     "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.8, "pbr": 1.96,
     "kr10y": None, "dy": 0.92},
]


def make_sandbox(tmp: Path) -> Path:
    root = tmp / "repo"
    (root / "scripts").mkdir(parents=True)
    (root / "data").mkdir()
    shutil.copy(SCRIPT, root / "scripts" / SCRIPT.name)
    write_data(root, BASE_ROWS)
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "test@example.com")
    run_git(root, "config", "user.name", "test")
    # 기준 커밋 하나
    run_git(root, "add", "-A")
    run_git(root, "commit", "-qm", "baseline")
    gate(root, "--update-manifest")
    run_git(root, "add", "-A")
    run_git(root, "commit", "-qm", "manifest")
    return root


def write_data(root: Path, rows):
    (root / "data" / "market-history.json").write_text(
        json.dumps({
            "builtAt": "2026-08-22",
            "source": {"kospi": "test"},
            "rows": rows,
            "dataFixes": [],
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def read_manifest(root: Path):
    return json.loads((root / "data" / "market-history.manifest.json").read_text(encoding="utf-8"))


def write_manifest(root: Path, m):
    (root / "data" / "market-history.manifest.json").write_text(
        json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def row_hash(row):
    """verify_data_integrity.row_hash 와 같은 정의 — 시험 쪽에서 따로 구현한다."""
    return hashlib.sha256(
        json.dumps(row, ensure_ascii=False, sort_keys=True,
                   separators=(",", ":")).encode("utf-8")).hexdigest()


def approve(root: Path, *entries):
    m = read_manifest(root)
    m["intentionalChanges"] = list(entries)
    write_manifest(root, m)


def run_git(root: Path, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, check=True)


def gate(root: Path, *args):
    return subprocess.run([sys.executable, "scripts/verify_data_integrity.py", *args],
                          cwd=root, capture_output=True, text=True)


CASES = []


def case(name, expect_pass, needle=None):
    def deco(fn):
        CASES.append((name, expect_pass, needle, fn))
        return fn
    return deco


@case("정상 파일", True)
def _(root):
    pass


@case("중복 날짜", False, "[중복]")
def _(root):
    rows = list(BASE_ROWS) + [dict(BASE_ROWS[1])]
    rows.sort(key=lambda r: r["d"])
    write_data(root, rows)


@case("날짜 역순", False, "[순서]")
def _(root):
    rows = list(BASE_ROWS)
    rows[1], rows[2] = rows[2], rows[1]
    write_data(root, rows)


@case("과거 행 삭제", False, "[미승인 변경]")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])


@case("과거 값 수정", False, "[미승인 변경]")
def _(root):
    rows = [dict(r) for r in BASE_ROWS]
    rows[1]["kospi"] = 9999.99
    write_data(root, rows)


@case("kospi 0", False, "[값]")
def _(root):
    rows = [dict(r) for r in BASE_ROWS]
    rows[2]["kospi"] = 0
    write_data(root, rows)


@case("최신 날짜 한 행 추가", True)
def _(root):
    write_data(root, list(BASE_ROWS) + [{
        "d": "2026-08-07", "kospi": 6650.00, "vix": 15.4, "fx": 1394.0,
        "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.9, "pbr": 1.97,
        "kr10y": None, "dy": 0.92}])


@case("승인된 과거 행 삭제", True)
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    approve(root, {
        "date": "2026-08-04", "changeType": "removed",
        "beforeHash": row_hash(BASE_ROWS[1]),
        "reason": "시험용 — KRX 공식 시세에 없는 날짜로 확인",
        "approvedAt": "2026-08-22"})


@case("승인 항목에 사유가 비면", False, "reason이 비어")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    approve(root, {"date": "2026-08-04", "changeType": "removed",
                   "beforeHash": row_hash(BASE_ROWS[1]), "reason": "  "})


@case("다른 날짜만 승인돼 있으면", False, "[미승인 변경]")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    approve(root, {"date": "2026-08-03", "changeType": "removed",
                   "beforeHash": row_hash(BASE_ROWS[0]), "reason": "엉뚱한 날짜"})


# ── 여기부터: 날짜만으로 영구 승인되는 것을 막는 규칙 ────────────────
# 같은 날짜라도 변경의 종류와 내용이 승인된 것과 다르면 통과하지 못해야 한다.

@case("삭제 승인으로 수정을 통과시키려 하면", False, "changeType")
def _(root):
    rows = [dict(r) for r in BASE_ROWS]
    rows[1]["kospi"] = 9999.99
    write_data(root, rows)
    approve(root, {"date": "2026-08-04", "changeType": "removed",
                   "beforeHash": row_hash(BASE_ROWS[1]),
                   "reason": "삭제만 승인했었다"})


@case("삭제 승인인데 행 내용이 다르면", False, "변경 전 행이 승인된 내용과 다릅니다")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    tampered = dict(BASE_ROWS[1]); tampered["kospi"] = 1.0
    approve(root, {"date": "2026-08-04", "changeType": "removed",
                   "beforeHash": row_hash(tampered),
                   "reason": "다른 내용의 행을 승인해 두었다"})


@case("해시 없는 승인", False, "beforeHash가 없습니다")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    approve(root, {"date": "2026-08-04", "changeType": "removed",
                   "reason": "날짜와 사유만 적었다"})


@case("changeType 없는 승인", False, "changeType")
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    approve(root, {"date": "2026-08-04", "beforeHash": row_hash(BASE_ROWS[1]),
                   "reason": "종류를 안 적었다"})


@case("승인된 수정 (전후 모두 일치)", True)
def _(root):
    rows = [dict(r) for r in BASE_ROWS]
    rows[1]["kospi"] = 6360.00
    write_data(root, rows)
    approve(root, {"date": "2026-08-04", "changeType": "modified",
                   "beforeHash": row_hash(BASE_ROWS[1]),
                   "afterHash": row_hash(rows[1]),
                   "reason": "시험용 — KRX 공식값으로 정정"})


@case("수정 승인인데 고친 값이 다르면", False, "변경 후 행이 승인된 내용과 다릅니다")
def _(root):
    rows = [dict(r) for r in BASE_ROWS]
    rows[1]["kospi"] = 7777.77          # 승인해 둔 값과 다른 값으로 고친다
    write_data(root, rows)
    approved_after = dict(BASE_ROWS[1]); approved_after["kospi"] = 6360.00
    approve(root, {"date": "2026-08-04", "changeType": "modified",
                   "beforeHash": row_hash(BASE_ROWS[1]),
                   "afterHash": row_hash(approved_after),
                   "reason": "6360으로 고치는 것만 승인했다"})


@case("승인된 과거 삽입", True)
def _(root):
    # 마지막 날짜보다 앞이므로 정상 증분이 아니라 과거 삽입으로 잡혀야 한다
    row = {"d": "2026-07-31", "kospi": 6100.0, "vix": 16.2, "fx": 1389.0,
           "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.4, "pbr": 1.89,
           "kr10y": None, "dy": 0.93}
    write_data(root, sorted(BASE_ROWS + [row], key=lambda r: r["d"]))
    approve(root, {"date": "2026-07-31", "changeType": "inserted",
                   "afterHash": row_hash(row),
                   "reason": "시험용 — 누락됐던 거래일 복원"})


@case("삽입 승인인데 넣은 행이 다르면", False, "변경 후 행이 승인된 내용과 다릅니다")
def _(root):
    row = {"d": "2026-07-31", "kospi": 6100.0, "vix": 16.2, "fx": 1389.0,
           "y10": 4.6, "spread": 0.5, "expYoY": 70.7, "per": 18.4, "pbr": 1.89,
           "kr10y": None, "dy": 0.93}
    other = dict(row); other["kospi"] = 5000.0
    write_data(root, sorted(BASE_ROWS + [other], key=lambda r: r["d"]))
    approve(root, {"date": "2026-07-31", "changeType": "inserted",
                   "afterHash": row_hash(row),
                   "reason": "6100 짜리 행만 승인했다"})


@case("--approve 로 기록하면 통과", True)
def _(root):
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    r = subprocess.run([sys.executable, "scripts/verify_data_integrity.py",
                        "--approve", "시험용 — 자동 기록"],
                       cwd=root, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    m = read_manifest(root)
    assert m["intentionalChanges"][0]["beforeHash"] == row_hash(BASE_ROWS[1]), m


@case("--approve 기록 후 다른 변경을 덧붙이면", False, "[미승인 변경]")
def _(root):
    # 삭제를 승인받은 뒤, 같은 승인으로 다른 날짜까지 고치려 시도한다
    write_data(root, [r for r in BASE_ROWS if r["d"] != "2026-08-04"])
    subprocess.run([sys.executable, "scripts/verify_data_integrity.py",
                    "--approve", "시험용 — 자동 기록"],
                   cwd=root, capture_output=True, text=True)
    rows = [dict(r) for r in BASE_ROWS if r["d"] != "2026-08-04"]
    rows[0]["kospi"] = 1234.56
    write_data(root, rows)


def main():
    passed = failed = 0
    for name, expect_pass, needle, mutate in CASES:
        with tempfile.TemporaryDirectory() as tmp:
            root = make_sandbox(Path(tmp))
            mutate(root)
            r = gate(root)
            ok = (r.returncode == 0) == expect_pass
            if ok and needle:
                ok = needle in r.stdout
            want = "통과" if expect_pass else "실패"
            got = "통과" if r.returncode == 0 else "실패"
            if ok:
                passed += 1
                print(f"  OK   {name:<22} → {got} (기대: {want})")
            else:
                failed += 1
                print(f"  NG   {name:<22} → {got} (기대: {want})")
                if needle and needle not in r.stdout:
                    print(f"       '{needle}' 가 출력에 없습니다")
                print("       " + "\n       ".join(r.stdout.strip().splitlines()[-8:]))
    print(f"\n{passed}개 통과, {failed}개 실패")
    return 1 if failed else 0


if __name__ == "__main__":
    print("데이터 무결성 게이트 자체 시험\n")
    raise SystemExit(main())
