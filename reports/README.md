# reports/

이 디렉터리의 대조 보고서는 **실행할 때마다 새로 만들어지는 산출물**이라
저장소에 커밋하지 않는다. `.gitignore`가 이 README만 남기고 나머지를 제외한다.

보고서를 다시 만들려면:

- GitHub Actions의 `krx-audit` 워크플로를 손으로 실행하거나(주 1회 자동 실행),
- KRX 계정이 있는 환경에서 `python3 scripts/audit-krx-year.py 2026` 을 돌린다.

결과 3종(`.md` 요약 / `.csv` 날짜별 대조표 / `.raw.json` KRX 응답 원문)은
Actions 아티팩트로 7일간 보관된다.

## 영구 증명은 어디에 있나

보고서 자체는 사라져도 **검증했다는 사실은 남아야 한다.** 그래서
조회 기간·공통 일수·불일치 건수·KRX 응답 해시·로컬 파일 해시·Actions run 번호를
`data/market-history.manifest.json` 의 `verifications` 에 적어 둔다.

`scripts/verify_data_integrity.py` 가 그 기록을 읽어, 이미 대조가 끝난 구간의
변동성 경고에는 "다시 조사할 필요가 없다"는 결론을 함께 출력한다.
