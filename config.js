require('dotenv').config();
const path = require('path');

const config = {
  // DART API
  dart: {
    apiKey: process.env.DART_API_KEY,
    baseUrl: 'https://opendart.fss.or.kr/api',
    cacheDays: 90,
  },

  // KIS API (백테스트용 과거 데이터)
  kis: {
    appKey: process.env.KIS_APP_KEY,
    appSecret: process.env.KIS_APP_SECRET,
    account: process.env.KIS_ACCOUNT,
    useMock: process.env.USE_MOCK === 'true',
    get baseUrl() {
      return this.useMock
        ? 'https://openapivts.koreainvestment.com:29443'
        : 'https://openapi.koreainvestment.com:9443';
    },
  },

  // 서버
  server: {
    port: parseInt(process.env.PORT) || 3003,
  },

  // auto-trader 연동
  autoTrader: {
    baseUrl: process.env.AUTO_TRADER_URL || 'http://localhost:3001',
    timeout: 5000,
  },

  // CORS 허용 origin (쉼표 구분으로 추가 가능)
  cors: {
    allowedOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3001')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  // 펀더멘털 점수 가중치
  fundamental: {
    weights: {
      valuation: 30,   // PER, PBR
      profitability: 30, // ROE, 영업이익률
      stability: 20,    // 부채비율, 유동비율
      growth: 20,       // 매출성장률, 영업이익성장률
    },
    minScore: 40,       // 매수 차단 기준
  },

  // 종합 자문 가중치
  advisory: {
    weights: {
      fundamental: 0.35,  // 펀더멘털 비중
      technical: 0.25,    // 기술적 비중
      risk: 0.25,         // 리스크 비중
      news: 0.15,         // 뉴스 센티먼트 비중
    },
    newsSentimentPath: process.env.NEWS_SENTIMENT_CACHE
      || path.join(__dirname, '..', 'invest-intelligence-loop', 'data', 'sentiment-cache.json'),
    newsSentimentTTL: 6 * 60 * 60 * 1000, // 6시간
  },

  // 섹터 매핑 (auto-trader와 동일)
  sectorMap: {
    '005930': 'TECH',
    '000660': 'TECH',
    '035420': 'TECH',
    '035720': 'TECH',
    '036570': 'TECH',
    '005380': 'AUTO',
    '000270': 'AUTO',
    '105560': 'FINANCE',
    '055550': 'FINANCE',
    '086790': 'FINANCE',
    '316140': 'FINANCE',
    '066570': 'TECH',
    '006400': 'TECH',
    '207940': 'BIO',
    '068270': 'BIO',
    '051910': 'CHEMICAL',
    '096770': 'ENERGY',
    '032830': 'FINANCE',
    '024110': 'FINANCE',
    '003550': 'TECH',
  },

  // 하락장 방어 정책
  defense: {
    volThreshold: 25,       // 20일 실현변동성 BEAR 기준 (연환산 %)
    momThreshold: -10,      // 60일 모멘텀 BEAR 기준 (%)
    bearMinConfidence: 70,  // BEAR 국면 매수 최소 신뢰도
    confirmDays: 2,         // 국면 전환 확인 기간 (whipsaw 방지)
  },

  // 퀀트 파이프라인 연동
  pipeline: {
    defaultStrategy: process.env.DEFAULT_STRATEGY || 'low_per_high_roe',
    enforceWhitelist: process.env.ENFORCE_WHITELIST === 'true',
    signalMaxAgeHours: parseInt(process.env.SIGNAL_MAX_AGE_HOURS) || 48,
  },

  // 데이터 경로
  dataPath: {
    fundamentals: './data/fundamentals',
    historical: './data/historical',
    backtestResults: './data/backtest-results',
    riskSnapshots: './data/risk-snapshots',
  },
};

module.exports = config;
