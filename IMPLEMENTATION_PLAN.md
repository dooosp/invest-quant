# Railway 배포 설계서

## 상태: Phase 2 설계 → 승인 대기

---

## 요약
invest-quant를 Railway에 배포. auto-trader(GitHub Actions)가 Railway URL로 호출.

## 아키텍처

```
Railway ($5 무료 크레딧/월)
└── invest-quant (PORT=Railway 자동) — sleep 모드 활용
    ├── Node.js 22 (Express)
    └── Python 3.12 (numpy, pandas) — venv at python/.venv

GitHub Actions (기존 유지)
└── auto-trader — 평일 cron
    └── INVEST_QUANT_URL=https://<railway-domain>
```

## 변경 파일

| # | 파일 | 작업 | 비고 |
|---|------|------|------|
| 1 | `Dockerfile` | 신규 | Node+Python 듀얼 런타임 |
| 2 | `.dockerignore` | 신규 | 빌드 컨텍스트 최적화 |
| 3 | `railway.toml` | 신규 | 배포 설정 + healthcheck |

**기존 코드 수정 없음** — python-bridge.js가 `python/.venv/bin/python3` 상대 경로 사용 (line 11), Dockerfile의 WORKDIR=/app과 호환.

---

## 상세 설계

### 1. Dockerfile (~25줄)

```dockerfile
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY python/requirements.txt ./python/
RUN python3 -m venv /app/python/.venv && \
    /app/python/.venv/bin/pip install --no-cache-dir -r python/requirements.txt

COPY . .

RUN mkdir -p data/fundamentals data/historical data/backtest-results data/risk-snapshots

CMD ["node", "server.js"]
```

### 2. .dockerignore

```
node_modules
.env
.git
data/
python/.venv
runs/
docs/
__tests__
```

### 3. railway.toml

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

---

## Railway 환경변수 (대시보드에서 수동 설정)

| 변수 | 값 |
|------|-----|
| `NODE_ENV` | `production` |
| `DART_API_KEY` | ~/.secrets에서 복사 |
| `KIS_APP_KEY` | ~/.secrets에서 복사 |
| `KIS_APP_SECRET` | ~/.secrets에서 복사 |
| `KIS_ACCOUNT` | ~/.secrets에서 복사 |
| `INVEST_QUANT_API_KEY` | 새로 생성 또는 기존 값 |

> `PORT`는 Railway가 자동 주입

## auto-trader GitHub Secret 변경

| Secret | 변경 |
|--------|------|
| `INVEST_QUANT_URL` | `https://<railway-domain>` |
| `INVEST_QUANT_API_KEY` | invest-quant과 동일 |
| `INVEST_QUANT_ENABLED` | `true` |

auto-trade.yml에 해당 env를 job에 전달하는지 확인 필요.

---

## 리스크 & 대응

| 리스크 | 대응 |
|--------|------|
| 무료 $5/월 초과 | Railway sleep 모드 (미사용 시 자동 sleep) → 실사용 시간만 과금 |
| data/ 휘발성 | 재시작 시 API로 재수집 (기존 로직) |
| 메모리 512MB | 단일 종목 분석이라 충분 |
| numpy 빌드 시간 | slim 이미지에 prebuilt wheel 사용 |

## 자가 비판

1. **sleep 후 cold start**: auto-trader 호출 시 서버 깨어나는 데 수초 소요 → timeout 5초(현 config)가 부족할 수 있음. auto-trader의 timeout을 15초로 올리는 것 권장
2. **Dockerfile vs nixpacks**: nixpacks가 자동 감지할 수 있지만 venv 경로 제어 어려움 → Dockerfile 명시가 안전
3. **railway.toml의 startCommand**: Dockerfile CMD와 중복 → railway.toml에서는 제거 (CMD 우선)

## 구현 순서

1. Dockerfile 작성
2. .dockerignore 작성
3. railway.toml 작성
4. git commit & push
5. Railway 대시보드: GitHub repo 연결 + 환경변수 설정
6. 배포 확인 (curl /health)
7. auto-trader GitHub Secret 업데이트
8. auto-trader 테스트 실행
