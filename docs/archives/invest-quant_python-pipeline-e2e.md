---
date: 2026-02-02
tags: [#python-pipeline, #e2e, #venv, #data-collection, #confirmDays, #kosdaq]
project: invest-quant
---

## 해결 문제 (Context)
- 이전 세션 미완료 과제 3건 완료 + Python 퀀트 파이프라인 e2e 구동

## 최종 핵심 로직 (Solution)

### 1. confirmDays 국면 전환 확인 (`regime-detector.js`)
- `confirmedRegime/pendingRegime/pendingDate/pendingCount` 상태 변수 추가
- 날짜 기반 카운트 (같은 날 중복 방지), CRISIS 즉시 전환 예외
- `clearCache()`: 캐시만 리셋 (pending 유지) / `resetAll()`: 전체 초기화
- API 응답에 `pending: { regime, count, required }` 필드 추가

### 2. KOSDAQ 수집 (`server.js`)
- `refreshKospiData` → `refreshMarketData`로 변경 (KOSPI + KOSDAQ 동시 수집)
- CRON/수동갱신/서버시작 모두 반영

### 3. 수집 기간 확장 (`scripts/collect-data.js`)
- `fetchDailyCandles(stock.code, 100)` → `365` 변경
- 기존 `*_100d.json` 50개 삭제, `*_365d.json` 50개 신규 생성
- **KIS 모의투자 API 100봉 제한** — 실제 수집은 100봉 (실투자 앱키 시 365봉 가능)

### 4. Python 퀀트 파이프라인 e2e
```
Spec → Data → Factors → Portfolio → Backtest → Report (2.1초)
```
- venv 세팅: `.venv` (numpy 2.4.2, pandas 3.0.0)
- `python-bridge.js`: `PYTHON` 경로를 `.venv/bin/python3`으로 변경
- 6개 Python 에이전트 모두 기존 코드 그대로 단독 실행 성공
- `pipeline-runner.js` e2e 5/5 단계 통과

### 5. 백테스트 결과 (low_per_high_roe 전략)
| 지표 | 값 |
|------|------|
| CAGR | 294.64% |
| Sharpe | 5.44 |
| MDD | -7.03% |
| IS Sharpe / OOS Sharpe | 4.41 / 7.57 |

## 핵심 통찰 (Learning & Decision)
- **Problem:** KIS 모의투자 앱키는 일봉 100개 제한 → 365일 요청해도 100봉만 반환
- **Decision:** 현재 100봉으로 운영, 실투자 전환 시 자동 확장됨 (코드 변경 불필요)
- **Problem:** python3.12-venv 패키지 미설치 상태
- **Decision:** sudo apt install로 해결 (WSL 환경 의존성)
- **Problem:** python-bridge.js가 시스템 python3 사용 → venv 패키지 못 찾음
- **Decision:** PYTHON 경로를 `.venv/bin/python3`으로 변경
- **Next Step:** 실투자 앱키 전환 시 365봉 수집 확인, 추가 전략 스펙 작성, PM2 오케스트레이션
