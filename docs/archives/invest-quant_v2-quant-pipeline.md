---
date: 2026-02-02
tags: [#invest-quant, #quant-pipeline, #factor-investing, #walk-forward, #node-python]
project: invest-quant
---

## 해결 문제 (Context)
- auto-trader가 TA 지표만으로 매매 → 퀀트 팩터(Value/Quality/Momentum) 기반 분석 파이프라인 부재
- 8-에이전트 퀀트 파이프라인 설계 및 구현 (Hypothesis→Data→Factor→Portfolio→Backtest→Report)

## 최종 핵심 로직 (Solution)

### 아키텍처: Node 오케스트레이터 + Python 워커

```
pipeline-runner.js (Node)
  ├→ python-bridge.js → data_agent.py      (가격/재무 패널 CSV)
  ├→ python-bridge.js → factor_agent.py    (팩터 스코어링)
  ├→ python-bridge.js → portfolio_agent.py (비중 최적화)
  ├→ python-bridge.js → backtest_agent.py  (Walk-Forward 검증)
  └→ python-bridge.js → reporter_agent.py  (Markdown 리포트)
```

### 주요 파일
| 경로 | 역할 |
|------|------|
| `python/core/schemas.py` | strategy_spec 검증 |
| `python/core/data_clock.py` | Lookahead bias 방지 (T-1 cutoff) |
| `python/core/cost_model.py` | 수수료 3bps + 슬리피지 5bps |
| `python/data_agent.py` | KIS 캐시 JSON → 정규화 DataFrame |
| `python/factor_agent.py` | 백분위 랭킹 + 복합 스코어 |
| `python/portfolio_agent.py` | top_n_equal + sector_cap 25% |
| `python/backtest_agent.py` | IS 70% / OOS 30% Walk-Forward |
| `modules/factor/python-bridge.js` | Node→Python child_process 브릿지 |
| `modules/integration/pipeline-runner.js` | 5단계 순차 오케스트레이션 |
| `modules/monitor/monitor-agent.js` | 드로다운 감시 (-3%/-8%/-12%) |
| `strategies/low_per_high_roe.json` | 전략 스펙 (Value 30% + Quality 30% + Mom 40%) |
| `scripts/collect-data.js` | KIS API 20종목 100일 캔들 수집 |

### 첫 실행 결과 (2026-02-02)
| 지표 | 전체 | In-Sample | Out-of-Sample |
|------|------|-----------|---------------|
| CAGR | 4.33% | 5.10% | 2.57% |
| Sharpe | 0.54 | 0.84 | -0.19 |
| MDD | -0.97% | -0.97% | -0.55% |

> Walk-Forward 경고: IS/OOS Sharpe 괴리 > 50% → 과최적화 의심

## 핵심 통찰 (Learning & Decision)
- **Problem:** DART API corp_code 미초기화 → 재무데이터(PER/PBR/ROE) 전량 수집 실패
- **Problem:** CSV 종목코드 앞자리 0 소실 (005930→5930) → `zfill(6)` + `dtype={"code":str}` 적용
- **Problem:** KIS 날짜 YYYYMMDD 포맷 → YYYY-MM-DD 변환 로직 추가
- **Decision:** Node+Python 하이브리드 선택 — Node는 오케스트레이션/API, Python은 수치 연산
- **Decision:** Walk-Forward IS/OOS 분리 검증 필수화 — 백테스트만 보면 과최적화 탐지 불가

## 다음 세션 TODO
1. DART corp_code 초기화 → corpCode.xml ZIP 다운로드/파싱
2. 재무데이터 수집 후 파이프라인 재실행 (Value/Quality 팩터 활성화)
3. PM2 활성화: `pm2 start ~/ecosystem.config.js` → invest-quant ↔ auto-trader 연동
4. advisory-engine.js에 팩터 랭크 게이트 통합
