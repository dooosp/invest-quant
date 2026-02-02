---
date: 2026-02-02
tags: [#invest-quant, #dart-corpcode, #factor-rank, #advisory-engine, #pipeline]
project: invest-quant
---

## 해결 문제 (Context)
- DART corp_code 순환의존 버그로 재무데이터 수집 전량 실패
- 파이프라인 팩터 선별 효과 부재 (유니버스=top_n=20)
- advisory-engine에 팩터 랭크 게이트 미연동

## 최종 핵심 로직 (Solution)

### 1. DART corp_code 해결
```
dart-client.js getCorpCode()
  이전: company.json (stock_code 파라미터) → 순환의존 에러
  이후: corpCode.xml ZIP 다운로드 → XML 파싱 → 3,911개 상장사 매핑 → _corp_codes.json 캐시 (30일 TTL)
```
- 의존성 추가: `adm-zip`

### 2. 유니버스 50종목 확장
- `scripts/collect-data.js` TARGETS: 20 → 50종목 (코스피200 기반)
- `portfolio_agent.py` SECTOR_MAP: 50종목 매핑 (13개 섹터)
- 팩터 선별 효과: **Top20 평균 +70.1% vs Bottom30 +12.7% = 프리미엄 +57.5%p**

### 3. advisory-engine 팩터 랭크 게이트
```javascript
// advisory-engine.js 추가 로직
loadLatestSignals()  // data/processed/*/signals.csv → 5분 TTL 캐시
adviseBuy() {
  // 기존: 펀더멘털(40%) + 기술(30%) + 리스크(30%)
  // 추가: 팩터 랭크 하위 50% → riskScore -20 감점
  // 응답에 factorRank, factorScore 포함
}
```

### 4. 새 API 엔드포인트
- `GET /api/factor-rank/:stockCode` → rank, total, compositeScore, factors

### 수정 파일 목록
| 파일 | 변경 |
|------|------|
| `modules/fundamental/dart-client.js` | corpCode.xml ZIP 방식 전환, adm-zip 추가 |
| `python/data_agent.py` | DART 캐시파일(`_2024_11011.json`) 필터 추가 |
| `python/portfolio_agent.py` | `dtype={"code": str}` + SECTOR_MAP 50종목 |
| `python/reporter_agent.py` | `dtype={"code": str}` 추가 |
| `scripts/collect-data.js` | TARGETS 50종목 확장 |
| `modules/integration/advisory-engine.js` | loadLatestSignals() + 팩터 랭크 게이트 |
| `server.js` | GET /api/factor-rank/:stockCode 추가 |

## 핵심 통찰 (Learning & Decision)
- **Problem:** DART company.json API는 corp_code가 필수 → stock_code로 조회 불가 (순환의존)
- **Decision:** corpCode.xml ZIP(3.4MB) 일괄 다운로드 → 30일 캐시. 개별 API 호출 대비 안정적
- **Problem:** CSV read_csv에 dtype 미지정 → 종목코드 0 소실이 3곳에서 반복 발생
- **Decision:** 모든 Python CSV 로딩에 `dtype={"code": str}` 필수화
- **Problem:** 유니버스=top_n일 때 팩터 선별 효과 0
- **Decision:** 유니버스 50 → top_n 20으로 확장. 모멘텀 팩터 상관 0.725 (강한 예측력)
- **Insight:** 상승장에서 모멘텀이 지배적 (상관 0.725), ROE는 거의 무효 (0.031). 하락장 방어 전략 별도 필요

## 다음 세션 TODO
1. PM2 재시작 후 advisory-engine 연동 테스트 (factor-rank API + buy advisory)
2. MCP gateway quant 도구에 팩터 랭크 연동
3. 하락장 방어 전략 설계 (Value/Quality 팩터 가중치 상향)
4. 데이터 수집 기간 확장 (100일 → 2년) — KIS API 일봉 한계 확인
