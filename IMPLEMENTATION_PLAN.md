# InvestQuant - 디지털 퀀트 자문 에이전트

## 상태: Phase 1~4 구현 완료

## 개요
auto-trader의 약점(펀더멘털 분석 부재, 백테스팅 불가)을 보완하는 독립형 정량분석 에이전트.
REST API로 auto-trader와 실시간 통신하여 매수/매도 자문을 제공한다.

## 아키텍처 (멀티 에이전트 오케스트레이션)

```
auto-trader (3001)  ──REST──>  InvestQuant (3003)
  trade-executor.js              advisory-engine.js
  (기술적 신호 + 매매 실행)       (펀더멘털 + 리스크 + 백테스트)
       └───────> 종합 판단 <──────┘
```

- **느슨한 결합**: InvestQuant 다운 시 auto-trader는 기존 로직으로 독립 작동 (5초 timeout)
- **자문 모델**: 권고만 제공, 최종 결정은 auto-trader
- **긴급매도 bypass**: 손절/트레일링스톱 등 긴급매도는 InvestQuant 호출 자체를 skip

## 프로젝트 구조

```
~/invest-quant/
├── server.js                          # Express 서버 (포트 3003)
├── config.js                          # 전체 설정 (DART/KIS/서버/자문 가중치)
├── package.json / .env.example / .gitignore
├── modules/
│   ├── fundamental/                   # Phase 1
│   │   ├── dart-client.js             # DART API 재무제표 조회 + corp_code 변환 + 캐싱(90일)
│   │   ├── ratio-calculator.js        # PER, PBR, ROE, 부채비율, 영업이익률, FCF, 성장률
│   │   ├── sector-comparator.js       # 동종업계 비교 (정적 벤치마크 + 동적 캐시)
│   │   └── fundamental-scorer.js      # 0-100점 (밸류에이션30 + 수익성30 + 안정성20 + 성장성20)
│   ├── backtest/                      # Phase 2
│   │   ├── data-collector.js          # KIS API 일봉 수집 + 1일 캐싱 + 200ms rate limit
│   │   ├── strategy-engine.js         # 6개 지표(RSI/MACD/BB/Stoch/ATR/Vol) + 다중확인 + 시뮬레이션
│   │   ├── performance-calc.js        # Sharpe, Sortino, MDD, Win Rate, Profit Factor
│   │   └── walk-forward.js            # Walk-forward 검증 (IS 70% / OOS 30%)
│   ├── risk/                          # Phase 3
│   │   ├── var-calculator.js          # Historical VaR (95%, 99%) + CVaR (꼬리 위험)
│   │   ├── correlation.js             # 피어슨 상관계수 (전체기간 + 최근 60일 단기)
│   │   ├── concentration.js           # HHI 집중도 + 섹터/종목 비중 경고
│   │   └── position-sizer.js          # Half-Kelly + ATR 기반 (min 50% ~ max 200% cap)
│   └── integration/                   # Phase 4
│       ├── advisory-engine.js         # 종합 자문 (펀더멘털 40% + 기술 30% + 리스크 30%)
│       └── auto-trader-client.js      # auto-trader API 클라이언트
├── data/
│   ├── fundamentals/                  # 종목별 재무 캐시 + corp_code 캐시
│   ├── historical/                    # 과거 OHLCV 캐시
│   ├── backtest-results/              # 백테스트 결과
│   └── risk-snapshots/                # 리스크 스냅샷
└── utils/
    ├── file-helper.js                 # JSON 원자적 저장 (tmp→rename) + 백업 복구 + 캐시
    └── logger.js                      # 모듈별 로거
```

## REST API

| 엔드포인트 | 메서드 | 핵심 동작 |
|-----------|--------|----------|
| `/health` | GET | 헬스체크 |
| `/api/fundamental/:stockCode` | GET | 펀더멘털 점수 조회 |
| `/api/advisory/buy` | POST | 종합 매수 자문 (펀더멘털+리스크+포지션사이징) |
| `/api/advisory/sell` | POST | 종합 매도 자문 (긴급 bypass) |
| `/api/risk/portfolio` | POST | VaR + 상관계수 + 집중도 분석 |
| `/api/backtest/run` | POST | 백테스트 실행 (walk-forward 옵션) |
| `/api/backtest/results` | GET | 과거 백테스트 결과 목록 |

## auto-trader 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `~/auto-trader/config.js` | `investQuant` 설정 블록 추가 (enabled, baseUrl, timeout, minFundamentalScore, adjustPositionSize) |
| `~/auto-trader/trade-executor.js` | `axios` require, `consultInvestQuant()` 메서드, `executeBuy()` 자문 호출 + 동적 매수금액, `executeSell()` 매도 자문 로그 (긴급매도 bypass) |

## auto-trader 연동 흐름

```
[매수]
executeBuy() → consultInvestQuant() → POST /api/advisory/buy
  ├─ approved=false → 매수 차단 (펀더멘털 < 40 or 집중도 위험)
  ├─ approved=true  → positionSize로 동적 매수금액 (Half-Kelly/ATR)
  └─ 연결실패       → null 반환 → 기존 로직 fallback

[매도]
executeSell() → isUrgentSell?
  ├─ Yes → InvestQuant skip → 즉시 매도
  └─ No  → POST /api/advisory/sell → 로그 기록 → 매도 진행
```

## 환경변수 (.env)

```
DART_API_KEY=           # DART 재무제표 (b2b-lead-agent와 동일)
KIS_APP_KEY=            # KIS API (auto-trader와 동일)
KIS_APP_SECRET=
KIS_ACCOUNT=
USE_MOCK=true
PORT=3003
AUTO_TRADER_URL=http://localhost:3001
```

auto-trader `.env` 추가:
```
INVEST_QUANT_ENABLED=true
INVEST_QUANT_URL=http://localhost:3003
```

## 보안

- self-healing-agent config.js에 등록 완료 (priority: high)
- pre-commit hook 심볼릭 링크 설치 완료
- 3중 방어 (Claude Code Hook + Pre-commit + Cron 스캔) 적용

## 향후 확장 가능

- [ ] 롤링 윈도우 Walk-forward (현재: 단일 70/30)
- [ ] auto-trader /api/portfolio 엔드포인트 추가 → 실시간 포트폴리오 연동
- [ ] 섹터 벤치마크 자동 갱신 (현재: 정적 fallback)
- [ ] advisory 가중치 백테스트 기반 자동 튜닝
- [ ] MCP 래핑 (펀더멘털 점수, VaR, 포지션사이징을 MCP 도구로 노출)
