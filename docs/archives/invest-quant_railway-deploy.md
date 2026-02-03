---
date: 2026-02-03
tags: [#railway, #deploy, #docker, #infra]
project: invest-quant + auto-trader
---

## 해결 문제 (Context)
- invest-quant를 외부 접근 가능한 서버에 배포하여 auto-trader(GitHub Actions)가 퀀트 자문 API를 호출할 수 있게 함
- Oracle Cloud VM 시도 후 복잡성으로 중단 → Railway로 전환

## 최종 핵심 로직 (Solution)

### 생성 파일 (invest-quant repo)

**Dockerfile** — Node.js 22 + Python 3.12 듀얼 런타임
```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY python/requirements.txt ./python/
RUN python3 -m venv /app/python/.venv && /app/python/.venv/bin/pip install --no-cache-dir -r python/requirements.txt
COPY . .
RUN mkdir -p data/fundamentals data/historical data/backtest-results data/risk-snapshots
CMD ["node", "server.js"]
```

**railway.toml** — Dockerfile builder + healthcheck
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"
[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### 변경 파일 (auto-trader repo)
- `auto-trade.yml`: screening/trade job에 `INVEST_QUANT_ENABLED`, `URL`, `API_KEY` env 추가
- `config.js`: `investQuant.timeout` 5000 → 15000ms

### 인프라 설정
- Railway 환경변수: NODE_ENV, DART_API_KEY, KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT, INVEST_QUANT_API_KEY
- auto-trader GitHub Secret: INVEST_QUANT_ENABLED, INVEST_QUANT_URL, INVEST_QUANT_API_KEY

## 핵심 통찰 (Learning & Decision)
- **Problem:** python-bridge.js가 `python/.venv/bin/python3` 상대 경로 사용 → Docker WORKDIR=/app에서 호환 확인 필요
- **Decision:** nixpacks 대신 Dockerfile 명시 → venv 경로 제어 가능, 빌드 예측 가능
- **Decision:** timeout 5초→15초 — Railway sleep 모드 후 cold start 대응
- **Next Step:** Trial 30일 후 유료 전환 필요 / data/ 휘발성은 API 재수집으로 대응

## 배포 정보
- URL: `https://invest-quant-production.up.railway.app`
- 플랜: Trial ($5 크레딧, 30일)
- 예상 월 비용: ~$2~3
