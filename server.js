require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { scoreFundamental } = require('./modules/fundamental/fundamental-scorer');
const { fetchDailyCandles, fetchIndexCandles } = require('./modules/backtest/data-collector');
const cron = require('node-cron');
const { runBacktest } = require('./modules/backtest/strategy-engine');
const { calculatePerformance } = require('./modules/backtest/performance-calc');
const { walkForwardValidation } = require('./modules/backtest/walk-forward');
const { calculatePortfolioVaR } = require('./modules/risk/var-calculator');
const { buildCorrelationMatrix } = require('./modules/risk/correlation');
const { analyzeConcentration } = require('./modules/risk/concentration');
const { adviseBuy, adviseSell, loadLatestSignals } = require('./modules/integration/advisory-engine');
const { saveData } = require('./utils/file-helper');
const logger = require('./utils/logger');
const authMiddleware = require('./middleware/auth');
const { validateBuyInput, validateSellInput, validateBacktestInput, validatePortfolioInput } = require('./middleware/validate');
const errorHandler = require('./middleware/error-handler');
const { asyncPool } = require('./utils/pool');
const { RateLimiter } = require('./utils/rate-limiter');

const app = express();
app.use(helmet());
app.use(cors({
  origin: config.cors.allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', authMiddleware);
app.use('/api', new RateLimiter({ windowMs: 60000, max: 30 }).middleware());

const MOD = 'Server';

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'invest-quant',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// --- 펀더멘털 조회 ---
app.get('/api/fundamental/:stockCode', async (req, res) => {
  const { stockCode } = req.params;
  const { marketCap, shares } = req.query;

  if (!/^\d{6}$/.test(stockCode)) {
    return res.status(400).json({ error: '종목코드는 6자리 숫자' });
  }

  if (!config.dart.apiKey) {
    return res.status(503).json({ error: 'DART_API_KEY 미설정' });
  }

  try {
    const mc = marketCap ? parseInt(marketCap) : null;
    const sh = shares ? parseInt(shares) : null;

    const result = await scoreFundamental(stockCode, mc, sh);
    res.json({ stockCode, ...result });
  } catch (error) {
    logger.error(MOD, `펀더멘털 조회 실패: ${stockCode}`, error);
    res.status(500).json({ error: '펀더멘털 분석 실패' });
  }
});

// --- 매수 종합 자문 (Phase 4: advisory-engine) ---
app.post('/api/advisory/buy', validateBuyInput, async (req, res) => {
  const { stockCode } = req.body;

  try {
    const result = await adviseBuy(req.body);
    logger.info(MOD, `매수 자문: ${stockCode} → ${result.approved ? 'APPROVED' : 'REJECTED'} (${result.reason})`);
    res.json(result);
  } catch (error) {
    logger.error(MOD, `매수 자문 실패: ${stockCode}`, error);
    res.json({
      approved: false, confidence: 0,
      fundamentalScore: null, positionSize: null,
      reasonCode: 'ERROR_SAFE_DENY',
      reason: '자문 처리 오류 — 안전 거부(수동 확인 필요)',
    });
  }
});

// --- 매도 종합 자문 (Phase 4: advisory-engine) ---
app.post('/api/advisory/sell', validateSellInput, async (req, res) => {
  const { stockCode } = req.body;

  try {
    const result = await adviseSell(req.body);
    logger.info(MOD, `매도 자문: ${stockCode} → ${result.approved ? 'APPROVED' : 'HOLD'} (${result.reason})`);
    res.json(result);
  } catch (error) {
    logger.error(MOD, `매도 자문 실패: ${stockCode}`, error);
    res.json({
      approved: false,
      reasonCode: 'ERROR_SAFE_DENY',
      reason: '매도 자문 오류 — 안전 거부(수동 확인 필요)',
    });
  }
});

// --- 포트폴리오 리스크 분석 ---
app.post('/api/risk/portfolio', validatePortfolioInput, async (req, res) => {
  const { holdings } = req.body;

  try {
    // 1. 각 종목 일별 수익률 수집 (동시성 제한 병렬)
    const limit = Number(process.env.KIS_CONCURRENCY) || 6;
    const candleResults = await asyncPool(limit, holdings, h => fetchDailyCandles(h.code, 120));

    const stocksData = [];
    for (let idx = 0; idx < holdings.length; idx++) {
      const h = holdings[idx];
      const candles = candleResults[idx].status === 'fulfilled' ? candleResults[idx].value : [];
      if (candles.length < 20) continue;
      const closes = candles.map(c => c.close);
      const dailyReturns = [];
      for (let i = 1; i < closes.length; i++) {
        dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
      const value = h.quantity * (h.currentPrice || closes[closes.length - 1]);
      stocksData.push({ code: h.code, name: h.name, dailyReturns, value, weight: 0 });
    }

    const totalValue = stocksData.reduce((s, d) => s + d.value, 0);
    stocksData.forEach(d => { d.weight = totalValue > 0 ? d.value / totalValue : 0; });

    // 2. 포트폴리오 VaR
    const portfolioVaR = calculatePortfolioVaR(stocksData);

    // 3. 상관계수
    const correlation = buildCorrelationMatrix(stocksData);

    // 4. 집중도
    const concentration = analyzeConcentration(
      stocksData.map(d => ({ code: d.code, name: d.name, value: d.value }))
    );

    const result = { portfolioVaR, correlation, concentration };

    // 스냅샷 저장
    const snapPath = `${config.dataPath.riskSnapshots}/snapshot_${Date.now()}.json`;
    saveData(snapPath, { ...result, timestamp: new Date().toISOString() });

    logger.info(MOD, `리스크 분석 완료: ${holdings.length}종목`);
    res.json(result);
  } catch (error) {
    logger.error(MOD, '리스크 분석 실패', error);
    res.status(500).json({ error: '리스크 분석 실패' });
  }
});

// --- 백테스트 실행 ---
app.post('/api/backtest/run', validateBacktestInput, async (req, res) => {
  const { stockCode, days, strategyConfig, walkForward } = req.body;

  try {
    const candles = await fetchDailyCandles(stockCode, days || 365);
    if (candles.length < 60) {
      return res.status(400).json({ error: `데이터 부족: ${candles.length}봉 (최소 60봉)` });
    }

    let result;
    if (walkForward) {
      result = walkForwardValidation(candles, strategyConfig || {});
    } else {
      const bt = runBacktest(candles, strategyConfig || {});
      const perf = calculatePerformance(bt);
      result = { performance: perf, trades: bt.trades, tradeCount: bt.trades.length };
    }

    // 결과 저장
    const resultPath = `${config.dataPath.backtestResults}/${stockCode}_${Date.now()}.json`;
    saveData(resultPath, { stockCode, days, walkForward, result, timestamp: new Date().toISOString() });

    logger.info(MOD, `백테스트 완료: ${stockCode} (${candles.length}봉)`);
    res.json({ stockCode, candleCount: candles.length, ...result });
  } catch (error) {
    logger.error(MOD, `백테스트 실패: ${stockCode}`, error);
    res.status(500).json({ error: '백테스트 실행 실패' });
  }
});

// --- 백테스트 결과 조회 ---
app.get('/api/backtest/results', (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const dir = path.resolve(__dirname, config.dataPath.backtestResults);

  if (!fs.existsSync(dir)) {
    return res.json({ results: [] });
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.includes('.backup'))
    .sort()
    .reverse()
    .slice(0, 20);

  const results = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch { return null; }
  }).filter(Boolean);

  res.json({ results });
});

// --- 팩터 랭크 조회 ---
app.get('/api/factor-rank/:stockCode', (req, res) => {
  const { stockCode } = req.params;
  if (!/^\d{6}$/.test(stockCode)) {
    return res.status(400).json({ error: '종목코드는 6자리 숫자' });
  }
  const signals = loadLatestSignals();
  if (!signals) return res.status(404).json({ error: '파이프라인 시그널 없음' });
  const sig = signals.map[stockCode];
  if (!sig) return res.status(404).json({ error: `${stockCode} 시그널 없음` });
  res.json({ stockCode, rank: sig.rank, total: signals.total, compositeScore: sig.composite_score, factors: sig });
});

// --- 퀀트 파이프라인 API ---
const pipelineRunner = require('./modules/integration/pipeline-runner');
const monitor = require('./modules/monitor/monitor-agent');
const fs2 = require('fs');
const path2 = require('path');

// 파이프라인 실행
app.post('/api/pipeline/run', async (req, res) => {
  try {
    const { strategy } = req.body;
    const specPath = path2.resolve(__dirname, 'strategies', `${strategy}.json`);
    if (!fs2.existsSync(specPath)) {
      return res.status(404).json({ error: `전략 스펙 없음: ${strategy}` });
    }
    const status = await pipelineRunner.run(specPath);
    res.json(status);
  } catch (error) {
    logger.error(MOD, `파이프라인 실패: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 파이프라인 결과 조회
app.get('/api/pipeline/results/:runId', (req, res) => {
  const runDir = path2.resolve(__dirname, 'runs', req.params.runId);
  const statusFile = path2.join(runDir, 'pipeline_status.json');
  if (!fs2.existsSync(statusFile)) return res.status(404).json({ error: 'Run not found' });
  const status = JSON.parse(fs2.readFileSync(statusFile, 'utf-8'));
  const resultFile = path2.join(runDir, 'run_result.json');
  const result = fs2.existsSync(resultFile) ? JSON.parse(fs2.readFileSync(resultFile, 'utf-8')) : null;
  res.json({ status, result });
});

// 전략 목록
app.get('/api/strategies', (req, res) => {
  const dir = path2.resolve(__dirname, 'strategies');
  if (!fs2.existsSync(dir)) return res.json({ strategies: [] });
  const files = fs2.readdirSync(dir).filter(f => f.endsWith('.json'));
  const strategies = files.map(f => {
    try { return JSON.parse(fs2.readFileSync(path2.join(dir, f), 'utf-8')); }
    catch { return { name: f.replace('.json', '') }; }
  });
  res.json({ strategies });
});

// 전략 등록
app.post('/api/strategies', (req, res) => {
  const spec = req.body;
  if (!spec.name) return res.status(400).json({ error: 'name 필수' });
  const dir = path2.resolve(__dirname, 'strategies');
  fs2.mkdirSync(dir, { recursive: true });
  fs2.writeFileSync(path2.join(dir, `${spec.name}.json`), JSON.stringify(spec, null, 2));
  res.json({ status: 'ok', name: spec.name });
});

// --- 시장 지수 수집 + 국면 갱신 ---
async function refreshMarketData() {
  const { clearCache } = require('./modules/risk/regime-detector');
  const results = {};
  for (const sym of ['KOSPI', 'KOSDAQ']) {
    try {
      const candles = await fetchIndexCandles(sym, 120);
      results[sym] = candles.length;
      logger.info(MOD, `${sym} 데이터 갱신: ${candles.length}봉`);
    } catch (e) {
      results[sym] = 0;
      logger.error(MOD, `${sym} 갱신 실패: ${e.message}`);
    }
  }
  clearCache();
  return results;
}

// 시장 국면 조회
app.get('/api/regime/status', (req, res) => {
  const { detectRegime } = require('./modules/risk/regime-detector');
  const { getPolicy } = require('./modules/risk/defense-policy');
  const info = detectRegime();
  const policy = getPolicy(info.regime);
  res.json({ ...info, policy });
});

// 시장 지수 수동 갱신 + 국면 재계산
app.post('/api/regime/refresh', async (req, res) => {
  const results = await refreshMarketData();
  const { detectRegime } = require('./modules/risk/regime-detector');
  const { getPolicy } = require('./modules/risk/defense-policy');
  const info = detectRegime();
  res.json({ refreshed: results, ...info, policy: getPolicy(info.regime) });
});

// --- 파이프라인 상태 + 시그널 신선도 ---
app.get('/api/pipeline/status', (req, res) => {
  const signals = loadLatestSignals();
  // 최근 실행 결과
  const runsDir = path2.resolve(__dirname, 'runs');
  let latestRunStatus = null;
  if (fs2.existsSync(runsDir)) {
    const dirs = fs2.readdirSync(runsDir).sort().reverse();
    for (const d of dirs) {
      const sf = path2.join(runsDir, d, 'pipeline_status.json');
      if (fs2.existsSync(sf)) {
        latestRunStatus = JSON.parse(fs2.readFileSync(sf, 'utf-8'));
        break;
      }
    }
  }
  res.json({
    signal: signals ? {
      totalStocks: signals.total,
      ageHours: signals.ageHours,
      isStale: signals.isStale,
      whitelistCount: signals.whitelist ? signals.whitelist.length : null,
    } : null,
    latestRun: latestRunStatus,
    config: {
      defaultStrategy: config.pipeline.defaultStrategy,
      enforceWhitelist: config.pipeline.enforceWhitelist,
      signalMaxAgeHours: config.pipeline.signalMaxAgeHours,
    },
  });
});

// 모니터링 상태
app.get('/api/monitor/status', (req, res) => {
  const autoTraderData = path2.resolve(__dirname, '..', 'auto-trader', 'data');
  const runsDir = path2.resolve(__dirname, 'runs');
  let latestRun = null;
  if (fs2.existsSync(runsDir)) {
    const dirs = fs2.readdirSync(runsDir).sort().reverse();
    if (dirs.length > 0) latestRun = path2.join(runsDir, dirs[0]);
  }
  const status = monitor.getStatus(autoTraderData, latestRun);
  res.json(status);
});

// --- 글로벌 에러 핸들러 (반드시 라우트 마지막에 등록) ---
app.use(errorHandler);

// --- 서버 시작 ---
const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(MOD, `InvestQuant 서버 시작 - 포트 ${PORT}`);
  logger.info(MOD, `DART API: ${config.dart.apiKey ? '설정됨' : '미설정'}`);
  logger.info(MOD, `auto-trader 연동: ${config.autoTrader.baseUrl}`);

  // 파이프라인 자동 실행: 매일 08:50 KST (장 개장 전)
  cron.schedule('50 8 * * 1-5', async () => {
    const strategy = config.pipeline.defaultStrategy;
    const specPath = path2.resolve(__dirname, 'strategies', `${strategy}.json`);
    if (!fs2.existsSync(specPath)) {
      logger.warn(MOD, `[CRON] 파이프라인 스펙 없음: ${strategy}`);
      return;
    }
    logger.info(MOD, `[CRON] 파이프라인 자동 실행: ${strategy}`);
    try {
      const status = await pipelineRunner.run(specPath);
      logger.info(MOD, `[CRON] 파이프라인 완료: ${status.error ? 'FAIL' : 'OK'} (${status.duration_ms}ms)`);
    } catch (e) {
      logger.error(MOD, `[CRON] 파이프라인 오류: ${e.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  // 시장 지수 스케줄러: 매일 09:05 KST (장 개장 직후)
  cron.schedule('5 9 * * 1-5', () => {
    logger.info(MOD, '[CRON] 시장 지수(KOSPI/KOSDAQ) 자동 수집 시작');
    refreshMarketData();
  }, { timezone: 'Asia/Seoul' });

  // 서버 시작 시 지수 데이터 없으면 즉시 수집
  const fs = require('fs');
  const histDir = require('path').resolve(__dirname, 'data/historical');
  const needRefresh = ['kospi_daily.json', 'kosdaq_daily.json'].some(f => !fs.existsSync(require('path').join(histDir, f)));
  if (needRefresh) {
    logger.info(MOD, '시장 지수 데이터 부족 → 즉시 수집');
    refreshMarketData();
  }
});

module.exports = app;
