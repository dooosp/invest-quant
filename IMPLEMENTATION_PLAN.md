# InvestQuant v2 — 퀀트 파이프라인 전면 고도화

## 상태: 설계 Phase 2 → 승인 대기

---

## 1. 개요

**목표**: "감이 아니라 데이터와 수학으로 투자 의사결정하는 파이프라인"

```
현재: auto-trader(TA 신호) → invest-quant(펀더멘털 점수) → 매수/매도
목표: Hypothesis → Data → Factor → Portfolio → Backtest → Live → Monitor → Report
     └─────────────── 퀀트 파이프라인 (invest-quant v2) ───────────────┘
```

**아키텍처**: Node 오케스트레이터(기존 서버 확장) + Python 워커(팩터/백테스트/최적화)

---

## 2. 반드시 막아야 할 퀀트 실패 8가지

| # | 실패 유형 | 방어 수단 |
|---|-----------|-----------|
| 1 | **룩어헤드** | data_clock.py — 리밸런싱 시점 이후 데이터 접근 차단 |
| 2 | **생존자 편향** | 유니버스에 상폐/구성 변경 종목 포함 |
| 3 | **과최적화** | walk-forward OOS 검증 강제, IS/OOS 성과 괴리 경고 |
| 4 | **거래비용 무시** | cost_model.py — 수수료 3bps + 슬리피지 5bps |
| 5 | **유동성 무시** | 거래량 필터 (하위 30% 제외) + 체결 가능량 제한 |
| 6 | **리스크 방치** | 섹터/팩터 노출도 모니터링 + 한도 초과 시 리밸런싱 |
| 7 | **레짐 전환** | regime_detector — 국면별 팩터 가중치 자동 조정 |
| 8 | **운영 리스크** | 시크릿 분리, 중복주문 방지키, 서킷브레이커, fail-closed |

---

## 3. 에이전트 구성 (8개)

### 3-1. Hypothesis Agent (가설 수립)

- **역할**: 자연어 전략 아이디어 → `strategy_spec.json` 생성
- **구현**: Node (server.js 엔드포인트)
- **입력**: 사용자 또는 MCP에서 전략 아이디어
- **출력**: `strategies/low_per_high_roe.json`

```json
{
  "name": "low_per_high_roe",
  "universe": {
    "market": "KR",
    "liquidity_filter": "top_70pct",
    "exclude": ["SPAC", "ETF", "REIT", "preferred"]
  },
  "rebalance": { "freq": "M", "day_rule": "first_trading_day" },
  "factors": [
    { "id": "value_per", "type": "ratio", "formula": "1/PER", "winsorize": [0.01, 0.99] },
    { "id": "quality_roe", "type": "ratio", "formula": "ROE", "zscore": true },
    { "id": "mom_60d", "type": "price_momentum", "lookback": 60, "skip": 5 }
  ],
  "signal": {
    "method": "rank_sum",
    "weights": { "value_per": 0.3, "quality_roe": 0.3, "mom_60d": 0.4 }
  },
  "portfolio": {
    "method": "top_n_equal",
    "n": 20,
    "max_weight": 0.08,
    "sector_cap": 0.25
  },
  "cost_model": { "fee_bps": 3, "slippage_bps": 5 },
  "risk_limits": {
    "max_turnover": 0.6,
    "max_drawdown_stop": 0.25,
    "daily_loss_limit": 0.03
  }
}
```

### 3-2. Data Agent (데이터 수집/정제)

- **역할**: 가격 + 재무 데이터 → 시점 정합성 보장된 패널 데이터
- **구현**: Python (`python/data_agent.py`)
- **핵심**: `data_clock.py` — 리밸런싱일 기준 T-1까지만 데이터 허용

```
입력: strategy_spec.json (유니버스, 팩터 정의)
처리:
  1. KIS API → 일봉 OHLCV (invest-quant data-collector 캐시 재활용)
  2. DART API → 재무제표 (invest-quant dart-client 캐시 재활용)
  3. 시점 정합성: 재무 데이터는 공시일+1 기준으로 사용 가능 시점 태깅
  4. winsorize + zscore 전처리
출력: data/processed/{strategy_name}/panel.parquet
```

### 3-3. Factor Model Agent (팩터 계산/시그널)

- **역할**: 패널 데이터 → 종목별 복합 스코어 → 랭킹
- **구현**: Python (`python/factor_agent.py`)

```
입력: panel.parquet + strategy_spec.factors
처리:
  1. 각 팩터별 cross-sectional 백분위 랭킹 (0~100)
  2. 복합 점수 = Σ(weight_i × rank_i)
  3. 상위 N개 선별
출력: data/processed/{strategy_name}/signals.parquet
```

### 3-4. Portfolio Agent (포트폴리오 구성)

- **역할**: 시그널 → 목표 비중 (제약 조건 반영)
- **구현**: Python (`python/portfolio_agent.py`)

```
MVP: top_n_equal (상위 N개 동일 비중)
제약:
  - max_weight: 종목당 최대 비중 (8%)
  - sector_cap: 섹터당 최대 비중 (25%)
  - max_turnover: 리밸런싱당 최대 회전율 (60%)
출력: data/processed/{strategy_name}/weights_{date}.json
```

### 3-5. Backtest Agent (검증)

- **역할**: 과거 데이터로 전략 시뮬레이션 + 성과 측정
- **구현**: Python (`python/backtest_agent.py`)
- **핵심**: 비용 반영 + walk-forward OOS 검증

```
입력: panel + signals + weights + cost_model
처리:
  1. 월별 리밸런싱 시뮬레이션
  2. 거래비용: fee_bps + slippage_bps
  3. 유동성 제약: 일거래량의 10% 초과 포지션 불가
  4. Walk-forward: 학습 70% / 검증 30% (기존 invest-quant 로직 참조)
출력:
  runs/{date}_{strategy}/run_result.json
  - CAGR, Sharpe, Sortino, MDD, Turnover, Win Rate, Profit Factor
  - 알파/베타 분해, 팩터별 노출도
  runs/{date}_{strategy}/trades.csv
```

### 3-6. Live/Paper Agent (실전/모의 실행)

- **역할**: 백테스트 통과한 전략 → auto-trader에 시그널 전달
- **구현**: Node (기존 advisory-engine.js 확장)
- **안전장치**:
  - 중복 주문 방지키: `(date, strategy, symbol)`
  - 상태 머신: NEW → SENT → FILLED / REJECTED
  - fail-closed: 데이터 결손 시 거래 안 함

```
호출 흐름:
  invest-quant → auto-trader /api/advisory/buy
    { stockCode, positionSize, factorScore, confidence, source: "quant-pipeline" }
```

### 3-7. Monitoring Agent (모니터링/중단)

- **역할**: 성과 드리프트, 노출 한도, 데이터 결손 감지
- **구현**: Node (modules/monitor/monitor-agent.js)

```
규칙:
  일일 손실 > 3% → PAUSE_BUY
  누적 MDD > 8% → REDUCE (50% 축소 권고)
  누적 MDD > 12% → LIQUIDATE
  IS/OOS 성과 괴리 > 50% → STRATEGY_DEGRADED 경고
  팩터 노출 편향 > 60% → REBALANCE_NEEDED
  데이터 결손 감지 → FAIL_CLOSED (매수 중단)
출력: 알림 (console + 향후 Slack/Email)
```

### 3-8. Reporter Agent (리포트)

- **역할**: "왜 이 종목/비중인지" 팩터 근거 설명
- **구현**: Python (`python/reporter_agent.py`)

```
출력: runs/{date}_{strategy}/report.md
내용:
  - 전략 요약 + 성과 지표 테이블
  - 상위 편입 종목 + 팩터별 기여도
  - 리스크 노출도 (섹터/팩터)
  - 레짐 상태 + 권장 노출도
```

---

## 4. 디렉터리 구조

```
invest-quant/
├── server.js                    # Node 오케스트레이터 (확장)
├── config.js                    # 설정 (확장)
├── package.json
├── modules/                     # Node 모듈 (기존 유지 + 확장)
│   ├── fundamental/             # 기존 유지 (DART, 펀더멘털 점수)
│   ├── backtest/                # 기존 유지 (walk-forward 등)
│   ├── risk/                    # 기존 유지 (VaR, 상관관계)
│   ├── integration/             # 기존 유지 + 파이프라인 오케스트레이터
│   │   ├── advisory-engine.js   # 기존 (Live Agent 역할 확장)
│   │   ├── auto-trader-client.js
│   │   └── pipeline-runner.js   # 신규: 파이프라인 오케스트레이터
│   ├── factor/                  # 신규
│   │   └── python-bridge.js     # Node→Python 워커 호출 브릿지
│   └── monitor/                 # 신규
│       └── monitor-agent.js     # 모니터링 + 중단 규칙
├── python/                      # 신규: Python 퀀트 워커
│   ├── requirements.txt         # numpy, pandas
│   ├── data_agent.py
│   ├── factor_agent.py
│   ├── portfolio_agent.py
│   ├── backtest_agent.py
│   ├── reporter_agent.py
│   └── core/
│       ├── schemas.py           # strategy_spec 검증
│       ├── data_clock.py        # 시점 정합성 (룩어헤드 방지)
│       ├── cost_model.py        # 수수료 + 슬리피지
│       └── risk_model.py        # 리스크 계산
├── strategies/                  # 전략 스펙 저장
│   └── low_per_high_roe.json    # 예시 전략
├── runs/                        # 실행 결과 (날짜별)
│   └── 2026-02-02_low_per_high_roe/
│       ├── strategy_spec.json
│       ├── run_result.json
│       ├── trades.csv
│       └── report.md
├── data/                        # 기존 + 확장
│   ├── fundamentals/            # 기존
│   ├── historical/              # 기존
│   ├── raw/                     # 신규: 원시 데이터
│   └── processed/               # 신규: 패널 데이터
├── middleware/                   # 기존 유지
├── utils/                       # 기존 유지
└── __tests__/                   # 기존 + 신규 테스트
```

---

## 5. 오케스트레이터 (pipeline-runner.js)

```
파이프라인 순서:
  1. strategy_spec.json 로드 + 스키마 검증
  2. python data_agent.py 호출 → panel.parquet
  3. python factor_agent.py 호출 → signals.parquet
  4. python portfolio_agent.py 호출 → weights.json
  5. python backtest_agent.py 호출 → run_result.json + trades.csv
  6. python reporter_agent.py 호출 → report.md
  7. 결과를 runs/ 에 저장 (재현 가능)
  8. (옵션) Live Agent → auto-trader에 시그널 전달

실패 처리:
  - 각 단계 실패 → 로그 + 중단 (다음 단계 진행 안 함)
  - 데이터 결손 → fail-closed
  - 타임아웃: Python 워커 60초
```

**Node→Python 호출 방식**: `child_process.execFile`
```
node pipeline-runner.js
  → python3 python/data_agent.py --spec strategies/xxx.json --output data/processed/xxx/
  → python3 python/factor_agent.py --input data/processed/xxx/panel.parquet ...
  → ...
```

---

## 6. 신규 API 엔드포인트

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/api/pipeline/run` | POST | 전략 스펙으로 파이프라인 실행 |
| `/api/pipeline/status/:runId` | GET | 실행 상태 조회 |
| `/api/pipeline/results/:runId` | GET | 결과 조회 |
| `/api/strategies` | GET | 등록된 전략 목록 |
| `/api/strategies` | POST | 새 전략 스펙 등록 |
| `/api/regime` | GET | 현재 시장 레짐 |
| `/api/monitor/status` | GET | 모니터링 상태 (드로우다운, 노출도) |

기존 엔드포인트 유지:
- `/api/advisory/buy` — Live Agent가 파이프라인 결과 반영
- `/api/advisory/sell` — 기존 유지
- `/api/fundamental/:stockCode` — 기존 유지
- `/api/risk/portfolio` — 기존 유지

---

## 7. 구현 순서

| Step | 작업 | 내용 | 규모 |
|------|------|------|------|
| 1 | Python 환경 세팅 | requirements.txt, venv, core/ 스켈레톤 | 설정 |
| 2 | core/schemas.py | strategy_spec 검증 (jsonschema) | ~40줄 |
| 3 | core/data_clock.py | 시점 정합성 엔진 (룩어헤드 방지) | ~35줄 |
| 4 | core/cost_model.py | 수수료+슬리피지 계산 | ~25줄 |
| 5 | data_agent.py | KIS/DART 데이터 → 패널 (기존 캐시 재활용) | ~50줄 |
| 6 | factor_agent.py | zscore/winsorize/rank + 복합 스코어 | ~50줄 |
| 7 | portfolio_agent.py | top_n_equal + 제약 조건 | ~45줄 |
| 8 | backtest_agent.py | 월 리밸런싱 시뮬레이션 + 성과 지표 | ~50줄 |
| 9 | reporter_agent.py | Markdown 리포트 생성 | ~40줄 |
| 10 | python-bridge.js | Node→Python child_process 브릿지 | ~35줄 |
| 11 | pipeline-runner.js | 오케스트레이터 (순차 호출 + 실패 처리) | ~45줄 |
| 12 | monitor-agent.js | 드로우다운/노출도/결손 감지 | ~45줄 |
| 13 | server.js 확장 | 신규 API 엔드포인트 추가 | ~40줄 |
| 14 | advisory-engine.js 개선 | 파이프라인 결과 반영 | ~30줄 수정 |
| 15 | 예시 전략 스펙 | low_per_high_roe.json 작성 | 스키마 |
| 16 | PM2 활성화 | ecosystem.config.js + env 설정 | 설정 |
| 17 | 통합 테스트 | 파이프라인 end-to-end 실행 | - |

---

## 8. 자가 비판 (Phase 3)

| 취약점 | 심각도 | 대응 |
|--------|--------|------|
| Python 워커 cold start 느림 | 중 | 파이프라인은 비실시간 (일 1회), 속도 무관 |
| KIS API 일봉 데이터 한계 (최대 100일) | 중 | 매일 수집+누적 캐시로 장기 데이터 구축 |
| pandas/numpy WSL 메모리 사용 | 하 | 종목 20개 수준이면 수십MB 이내 |
| 생존자 편향 완전 제거 어려움 | 중 | v1에서는 현재 상장 종목만, 향후 과거 구성종목 DB 추가 |
| parquet 의존성 추가 | 하 | CSV fallback 가능, MVP에서는 CSV도 충분 |
| Node↔Python IPC 오버헤드 | 하 | child_process + JSON stdio, 복잡도 낮음 |
| 실적 블랙아웃 미구현 | 중 | v2에서 DART 공시일 기반 추가 예정 |

### 범위 제한 (Over-engineering 방지)
- MVP: CSV 기반 (parquet은 향후)
- 포트폴리오 최적화: equal-weight만 (mean-variance는 향후)
- 레짐 감지: 200MA + ATR만 (ADX는 향후)
- 모니터링 알림: console만 (Slack/Email은 향후)

---

## 9. 승인 요청

위 설계에 대해 승인 부탁드립니다.
수정/추가 요청 사항이 있으면 말씀해 주세요.
