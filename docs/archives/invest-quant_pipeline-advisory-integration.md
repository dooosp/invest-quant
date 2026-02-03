---
date: 2026-02-02
tags: [#advisory-engine, #pipeline, #whitelist, #signal-freshness, #pm2]
project: invest-quant
---

## 해결 문제 (Context)
- 퀀트 파이프라인(signals.csv, weights.json)과 Advisory Engine 간 연동이 느슨 -> 오래된 시그널로 매수 승인되거나, 파이프라인 결과(화이트리스트)가 매수 게이트에 반영되지 않는 문제

## 최종 핵심 로직 (Solution)

### 1. config.js — pipeline 섹션 추가
```javascript
pipeline: {
  defaultStrategy: process.env.DEFAULT_STRATEGY || 'low_per_high_roe',
  enforceWhitelist: process.env.ENFORCE_WHITELIST === 'true',
  signalMaxAgeHours: parseInt(process.env.SIGNAL_MAX_AGE_HOURS) || 48,
}
```

### 2. advisory-engine.js — loadLatestSignals() 강화
- signals.csv mtime 기반 `ageHours`, `isStale` 계산
- weights.json에서 화이트리스트 로드

### 3. advisory-engine.js — adviseBuy() 팩터 랭크 게이트 교체
- 48h 초과 → 즉시 차단 (SIGNAL_TOO_OLD)
- 24~48h → 신뢰도 -15점 감점
- ENFORCE_WHITELIST=true → weights.json 미포함 종목 차단 (NOT_IN_WHITELIST)
- ENFORCE_WHITELIST=false → 기존 동작 (하위 50% 감점만)

### 4. server.js — cron + 상태 API
- `cron.schedule('50 8 * * 1-5')` → 파이프라인 자동 실행 (장 개장 전)
- `GET /api/pipeline/status` → 시그널 신선도 + 최근 실행 결과 + 설정 조회

### 5. PM2 프로세스 등록
| id | name | 역할 |
|----|------|------|
| 0 | invest-quant | 퀀트 서버 (3003) + 파이프라인 cron |
| 1 | auto-trader-scheduler | 매매 스케줄러 (9~15시 매시간) |
| 2 | auto-trader-dashboard | 대시보드 (3001) |

## 핵심 통찰 (Learning & Decision)
- **Problem:** 펀더멘털에서 먼저 차단되는 종목이 많아 화이트리스트 차단까지 도달하지 않음 → API 테스트로는 화이트리스트 로직 검증 어려움
- **Decision:** 단위테스트(loadLatestSignals → whitelist.includes)로 분기 로직 직접 검증. 5개 검증 케이스 모두 통과 확인
- **Next Step:** ENFORCE_WHITELIST=true 상태로 운영 중. 실전 매매에서 화이트리스트 차단 로그 모니터링 필요. `pm2 logs invest-quant`에서 "화이트리스트 미포함" 메시지 확인
