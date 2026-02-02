---
date: 2026-01-30
tags: [#pm2, #orchestration, #infra, #multi-agent]
project: invest-quant + auto-trader
---

## 해결 문제 (Context)
- invest-quant가 수동 실행이라 auto-trader와 실시간 연동 불가 → 멀티에이전트 오케스트레이션 병목

## 최종 핵심 로직 (Solution)

### 1. pm2 ecosystem 설정 (~/ecosystem.config.js)
```js
module.exports = {
  apps: [
    {
      name: 'invest-quant',
      script: 'server.js',
      cwd: '/home/taeho/invest-quant',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'auto-trader',
      script: 'trade-scheduler.js',
      cwd: '/home/taeho/auto-trader',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: { NODE_ENV: 'production', INVEST_QUANT_ENABLED: 'true' },
    },
  ],
};
```

### 2. 환경변수 정비
- `~/invest-quant/.env`에 DART/KIS 키 추가 (기존 누락)
- 양쪽 `.env`에 동일한 `INVEST_QUANT_API_KEY` 확인

### 3. .bashrc 주석 오류 수정
```bash
# Before (한글 주석이 export에 넘어가 오류)
[ -f ~/.secrets/.env ] && export $(cat ~/.secrets/.env | xargs)

# After
[ -f ~/.secrets/.env ] && export $(grep -v '^#' ~/.secrets/.env | grep -v '^$' | xargs)
```

## 핵심 통찰 (Learning & Decision)
- **Problem:** systemd vs pm2 선택. 에이전트 12개+ 확장, WSL 환경 고려.
- **Decision:** pm2 채택. 이유: ecosystem.config.js 하나로 선언적 관리, 에이전트 추가 = 블록 1개, WSL 호환 안정적, `pm2 monit` 내장 모니터링.
- **핵심 발견:** 코드 레벨 연동(consultInvestQuant, REST API)은 이미 완성 상태 → 인프라 설정만으로 연동 활성화. 코드 변경 0줄.
- **Next Step:**
  - 실매매 데이터 축적 후 advisory 가중치 튜닝
  - 새 에이전트 추가 시 ecosystem.config.js에 블록 추가
  - WebSocket 푸시 알림 (리스크 경고 → auto-trader) 검토
