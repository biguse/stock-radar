"""
가격 데이터 계보 검증 — 네이버 수집본 ↔ KRX 공식값 대조.

2차 검증 지적: 가격 원천이 KRX가 아니라 네이버 HTML이고, 원자료 해시나
수집 스냅샷이 없어 값이 바뀌어도 소급 수정인지 수집 오류인지 알 수 없다.

이 스크립트는 KRX 공식 지수 시세(pykrx, KRX 계정 필요)를 받아 우리
data/market-history.json의 종가와 날짜별로 대조하고, 결과와 파일 해시를
data/price-lineage.json에 남긴다.

실행: python scripts/verify-price-lineage.py [시작연도]
"""
import os, sys, json, time, hashlib, warnings, pathlib
from datetime import date

warnings.filterwarnings('ignore')
ROOT = pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)

_env = pathlib.Path('.env.local')
if _env.exists():
    for line in _env.read_text(encoding='utf-8').splitlines():
        if line.strip() and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

if not os.environ.get('KRX_ID') or not os.environ.get('KRX_PW'):
    print('KRX_ID / KRX_PW 가 없습니다. 대조를 건너뜁니다.', file=sys.stderr)
    sys.exit(0)

from pykrx import stock

START_YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 1990
KOSPI = "1001"
TOL = 0.01  # 소수점 둘째 자리까지 같으면 일치로 본다

hist_path = pathlib.Path('data/market-history.json')
raw = hist_path.read_bytes()
hist = json.loads(raw)
ours = {r['d']: r['kospi'] for r in hist['rows']}
print(f"우리 데이터 {len(ours):,}일 ({min(ours)} ~ {max(ours)})")
print(f"파일 SHA-256 {hashlib.sha256(raw).hexdigest()[:32]}…\n")

krx = {}
for year in range(START_YEAR, date.today().year + 1):
    a = f"{year}0101"
    b = f"{year}1231" if year < date.today().year else date.today().strftime("%Y%m%d")
    df = None
    for attempt in range(3):
        try:
            df = stock.get_index_ohlcv(a, b, KOSPI)
            break
        except Exception as e:
            if attempt == 2:
                print(f"  {year} 실패: {str(e)[:60]}", file=sys.stderr)
            time.sleep(2)
    if df is None or len(df) == 0:
        continue
    for idx, row in df.iterrows():
        krx[idx.strftime('%Y-%m-%d')] = float(row['종가'])
    print(f"  {year}: KRX {len(df)}일", end='\r')
    time.sleep(0.3)

print(f"\nKRX 공식 {len(krx):,}일 ({min(krx)} ~ {max(krx)})\n")

both = sorted(set(ours) & set(krx))
only_ours = sorted(set(ours) - set(krx))
only_krx = sorted(set(krx) - set(ours))

mismatches = []
max_diff = 0.0
for d in both:
    diff = abs(ours[d] - krx[d])
    if diff > max_diff:
        max_diff = diff
    if diff > TOL:
        mismatches.append({'d': d, 'naver': ours[d], 'krx': krx[d], 'diff': round(diff, 4)})

print("■ 대조 결과")
print(f"  양쪽 모두 존재      {len(both):,}일")
print(f"  값 일치            {len(both) - len(mismatches):,}일 ({(len(both)-len(mismatches))/max(1,len(both))*100:.3f}%)")
print(f"  값 불일치          {len(mismatches):,}일")
print(f"  최대 차이          {max_diff:.4f}")
print(f"  우리에만 있음       {len(only_ours):,}일")
print(f"  KRX에만 있음       {len(only_krx):,}일")

if mismatches:
    print("\n■ 불일치 상위 15건")
    for m in sorted(mismatches, key=lambda x: -x['diff'])[:15]:
        print(f"  {m['d']}  네이버 {m['naver']:>10,.2f}  KRX {m['krx']:>10,.2f}  차이 {m['diff']:>8.2f}")
if only_ours[:5]:
    print(f"\n■ 우리에만 있는 날짜 (앞 5개): {only_ours[:5]}")
if only_krx[:5]:
    print(f"■ KRX에만 있는 날짜 (앞 5개): {only_krx[:5]}")

result = {
    'checkedAt': date.today().isoformat(),
    'source': 'pykrx get_index_ohlcv(1001) — KRX 공식 지수 시세',
    'historyFileSha256': hashlib.sha256(raw).hexdigest(),
    'ourDays': len(ours), 'krxDays': len(krx), 'comparedDays': len(both),
    'matched': len(both) - len(mismatches),
    'mismatchCount': len(mismatches),
    'maxAbsDiff': round(max_diff, 4),
    'tolerance': TOL,
    'onlyOurs': only_ours[:200], 'onlyKrx': only_krx[:200],
    'mismatches': sorted(mismatches, key=lambda x: -x['diff'])[:200],
}
pathlib.Path('data/price-lineage.json').write_text(
    json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print("\ndata/price-lineage.json 저장")

# 불일치가 전체의 0.1%를 넘으면 실패로 본다
if len(both) and len(mismatches) / len(both) > 0.001:
    print("\n경고: 불일치 비율이 0.1%를 넘습니다.", file=sys.stderr)
    sys.exit(1)
