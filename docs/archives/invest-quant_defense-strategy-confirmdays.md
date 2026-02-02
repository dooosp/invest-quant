---
date: 2026-02-02
tags: [#regime-detection, #confirmDays, #kosdaq, #defense-strategy]
project: invest-quant
---

## 해결 문제 (Context)
- 이전 세션에서 구현한 하락장 방어 전략의 미완료 과제 3건 완료
- confirmDays 미적용 (whipsaw 취약), KOSDAQ 미수집, 개별종목 수집기간 부족

## 최종 핵심 로직 (Solution)

### 1. confirmDays 국면 전환 확인 (`modules/risk/regime-detector.js`)
```javascript
// 상태 변수
let confirmedRegime = null;   // 확정된 국면
let pendingRegime = null;     // 전환 대기 국면
let pendingDate = null;       // 전환 대기 시작 날짜 (YYYY-MM-DD)
let pendingCount = 0;         // 연속 확인 일수

// 핵심 분기 (detectRegime 내부)
// 1. rawRegime === confirmedRegime → pending 초기화, 유지
// 2. rawRegime === 'CRISIS' → 즉시 전환 (지연 불가)
// 3. pendingRegime === rawRegime + 다른 날짜 → pendingCount++
//    → pendingCount >= confirmDays → 확정
// 4. 새로운 pending → pendingCount = 1, 대기 시작
```
- `clearCache()`: 캐시만 리셋 (pending 유지 — 데이터 갱신 시 전환 카운트 보존)
- `resetAll()`: 전체 상태 초기화 (테스트/수동 리셋용)
- API 응답에 `pending: { regime, count, required }` 필드 추가

### 2. KOSDAQ 수집 (`server.js`)
```javascript
// refreshKospiData → refreshMarketData로 변경
async function refreshMarketData() {
  for (const sym of ['KOSPI', 'KOSDAQ']) {
    const candles = await fetchIndexCandles(sym, 120);
  }
  clearCache();
}
```
- CRON(09:05 KST), POST /api/regime/refresh, 서버 시작 시 모두 반영

### 3. 수집 기간 확장 (`scripts/collect-data.js`)
- `fetchDailyCandles(stock.code, 100)` → `365` 변경
- 기존 `*_100d.json` 50개 파일 삭제 완료

## 핵심 통찰 (Learning & Decision)
- **Problem:** 5분 캐시 TTL 내 반복 호출 시 pendingCount 중복 증가 위험
- **Decision:** 날짜 기반 카운트 (`today !== pendingDate`일 때만 증가) — 같은 날 여러 번 호출해도 1회만 카운트
- **Decision:** CRISIS는 confirmDays 생략 (리스크 관리 > whipsaw 방지)
- **Decision:** clearCache()에서 pending 상태 유지 — 데이터 갱신(clearCache)과 국면 전환 확인은 독립적
- **Next Step:** KOSDAQ 국면 활용 여부 결정, Python 퀀트 워커 구현, collect-data.js 365일 실행
