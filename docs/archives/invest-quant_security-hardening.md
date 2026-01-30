---
date: 2026-01-30
tags: [#security, #hardening, #auth, #circuit-breaker, #testing, #helmet, #cors]
project: invest-quant + auto-trader
---

## 해결 문제 (Context)
- invest-quant를 "운영 가능 수준"으로 올리기 위한 종합 보안/안정성 감사 및 패치

## 변경 파일 요약

### invest-quant (19파일, +966/-81)
| 파일 | 변경 |
|------|------|
| `server.js` | helmet, cors, auth/validate/errorHandler middleware 연결, safe deny |
| `config.js` | CORS allowedOrigins 설정 추가 |
| `middleware/auth.js` | API 인증 (constant-time 비교, dev만 bypass, 운영 키 누락=500) |
| `middleware/validate.js` | buy/sell/backtest/portfolio 입력검증 + prototype pollution 차단 |
| `middleware/error-handler.js` | 글로벌 에러 핸들러 (production stack 미노출) |
| `utils/logger.js` | 시크릿 마스킹 (API key, OAuth token, 계좌번호) |
| `utils/circuit-breaker.js` | CB 유틸 (threshold/resetTimeout/HALF_OPEN) |
| `modules/backtest/data-collector.js` | KIS 토큰 Promise singleton lock + expires_in + kisCB 연결 |
| `modules/fundamental/dart-client.js` | dartCB 연결 (withRetry 바깥에서 래핑) |
| `modules/fundamental/ratio-calculator.js` | _safeDiv, _safePct 테스트용 export |
| `__tests__/*.test.js` (6개) | 유닛테스트 51개 (node:test, 의존성 0) |
| `package.json` | helmet, cors 의존성 + test 스크립트 |
| `.env.example` | INVEST_QUANT_API_KEY, NODE_ENV 추가 |

### auto-trader (3파일)
| 파일 | 변경 |
|------|------|
| `config.js` | investQuant.apiKey 필드 추가 |
| `trade-executor.js` | buy/sell 호출에 x-api-key 헤더 전송 |
| `.env.example` | INVEST_QUANT_ENABLED/URL/API_KEY 추가 |

## 최종 핵심 로직 (Solution)

### P0: Safe Deny (에러 시 매수 차단)
```javascript
// server.js — 기존: approved:true → 변경: approved:false
catch (error) {
  res.json({
    approved: false, confidence: 0,
    reasonCode: 'ERROR_SAFE_DENY',
    reason: '자문 처리 오류 — 안전 거부(수동 확인 필요)',
  });
}
```

### P0: API 인증 (constant-time 비교)
```javascript
// middleware/auth.js 핵심
const crypto = require('crypto');
function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
// dev만 bypass, 운영 키 누락 → 500
```

### P1: Circuit Breaker 래핑 구조
```
dartCB.call(() => withRetry(() => axios.get(...)))
│              │              └─ 개별 요청 재시도 3회
│              └─ 재시도 묶음 전체를 CB가 감시
└─ 연속 3세트 실패 → 30초 OPEN
```

### P1: KIS 토큰 싱글턴 lock
```javascript
let tokenPromise = null;
async function getAccessToken() {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) return accessToken;
  if (tokenPromise) return tokenPromise; // 동시 요청 대기
  tokenPromise = (async () => { /* 발급 */ })().finally(() => tokenPromise = null);
  return tokenPromise;
}
```

## 핵심 통찰 (Learning & Decision)

- **Problem 1:** 에러 fallback이 `approved:true` — 장애 = 무조건 매수 승인
- **Decision:** HTTP 200 유지 + `approved:false` + `reasonCode` 추가. 500 반환은 upstream 오해 위험.

- **Problem 2:** auth bypass 조건이 "키 미설정 시 무조건 통과"
- **Decision:** `NODE_ENV=development`에서만 bypass. 운영에서 키 누락 → 500 차단.

- **Problem 3:** CB를 withRetry 안에 넣으면 개별 실패마다 카운트되어 너무 빨리 열림
- **Decision:** CB를 withRetry **바깥**에 배치 → 재시도 3회 전부 실패 = CB failure 1회.

- **Problem 4:** Sortino 테스트 실패 — 일정 상승 시 하방편차 0 → Sortino=0
- **Decision:** 구현이 정확하고 테스트 기대값이 잘못됨. 변동 있는 데이터로 별도 테스트 추가.

- **Next Step:**
  - invest-quant 클라우드 배포 (Render) → 24시간 가동 시 auto-trader Actions와 완전 연동
  - 현재는 로컬 꺼지면 invest-quant 없이 auto-trader 단독 매매 (기술적 분석만)
  - Rate limiting — 외부 노출 시 필수
  - 통합 테스트 — 기능 변경 시 추가

## 환경 설정 (운영)

| 변수 | 위치 | 용도 |
|------|------|------|
| `INVEST_QUANT_API_KEY` | 양쪽 .env + ~/.secrets/.env | API 인증 (32바이트 hex) |
| `NODE_ENV=production` | invest-quant .env | stack 미노출 + auth bypass 차단 |
| `INVEST_QUANT_ENABLED=true` | auto-trader .env | 연동 활성화 |

## Git 커밋

| 프로젝트 | 커밋 | 메시지 |
|---------|------|--------|
| invest-quant | `fef1782` | 보안/안정성 강화: 인증·검증·에러처리·로그마스킹·CB·테스트·Helmet+CORS |
| auto-trader | `8864c38` | invest-quant 연동: 인증 헤더(x-api-key) 추가 + 환경변수 문서화 |
| auto-trader | `c20bde7` | 안정성 강화: KIS API 재시도/CB, 입력검증, 로그마스킹, 매도 버그 수정 |
| auto-trader | `317c6fc` | docs: 과매매 방지 버그픽스 아카이브 문서 추가 |
| auto-trader | `2c22709` | chore: .gitignore에 *.backup 패턴 추가 |
