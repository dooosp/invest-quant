require('dotenv').config();

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
      fundamental: 0.4,  // 펀더멘털 비중
      technical: 0.3,     // 기술적 비중
      risk: 0.3,          // 리스크 비중
    },
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

  // 데이터 경로
  dataPath: {
    fundamentals: './data/fundamentals',
    historical: './data/historical',
    backtestResults: './data/backtest-results',
    riskSnapshots: './data/risk-snapshots',
  },
};

module.exports = config;
