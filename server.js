require('dotenv').config();

const express = require('express');
const config = require('./config');
const { scoreFundamental } = require('./modules/fundamental/fundamental-scorer');
const { fetchDailyCandles } = require('./modules/backtest/data-collector');
const { runBacktest } = require('./modules/backtest/strategy-engine');
const { calculatePerformance } = require('./modules/backtest/performance-calc');
const { walkForwardValidation } = require('./modules/backtest/walk-forward');
const { calculateVaR, calculatePortfolioVaR } = require('./modules/risk/var-calculator');
const { buildCorrelationMatrix } = require('./modules/risk/correlation');
const { analyzeConcentration } = require('./modules/risk/concentration');
const { calculatePositionSize } = require('./modules/risk/position-sizer');
const { adviseBuy, adviseSell } = require('./modules/integration/advisory-engine');
const { loadData, saveData } = require('./utils/file-helper');
const logger = require('./utils/logger');

const app = express();
app.use(express.json());

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
app.post('/api/advisory/buy', async (req, res) => {
  const { stockCode } = req.body;

  if (!stockCode || !/^\d{6}$/.test(stockCode)) {
    return res.status(400).json({ error: '유효한 종목코드 필요' });
  }

  try {
    const result = await adviseBuy(req.body);
    logger.info(MOD, `매수 자문: ${stockCode} → ${result.approved ? 'APPROVED' : 'REJECTED'} (${result.reason})`);
    res.json(result);
  } catch (error) {
    logger.error(MOD, `매수 자문 실패: ${stockCode}`, error);
    res.json({
      approved: true, confidence: 0,
      fundamentalScore: null, positionSize: null,
      reason: 'InvestQuant 분석 실패 - fallback 통과',
    });
  }
});

// --- 매도 종합 자문 (Phase 4: advisory-engine) ---
app.post('/api/advisory/sell', async (req, res) => {
  const { stockCode } = req.body;

  if (!stockCode || !/^\d{6}$/.test(stockCode)) {
    return res.status(400).json({ error: '유효한 종목코드 필요' });
  }

  try {
    const result = await adviseSell(req.body);
    logger.info(MOD, `매도 자문: ${stockCode} → ${result.approved ? 'APPROVED' : 'HOLD'} (${result.reason})`);
    res.json(result);
  } catch (error) {
    logger.error(MOD, `매도 자문 실패: ${stockCode}`, error);
    res.json({ approved: true, reason: 'InvestQuant 분석 실패 - fallback 승인' });
  }
});

// --- 포트폴리오 리스크 분석 ---
app.post('/api/risk/portfolio', async (req, res) => {
  const { holdings, accountBalance } = req.body;
  // holdings: [{code, name, quantity, avgPrice, currentPrice}]

  if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
    return res.status(400).json({ error: 'holdings 배열 필요' });
  }

  try {
    // 1. 각 종목 일별 수익률 수집
    const stocksData = [];
    for (const h of holdings) {
      const candles = await fetchDailyCandles(h.code, 120);
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
app.post('/api/backtest/run', async (req, res) => {
  const { stockCode, days, strategyConfig, walkForward } = req.body;

  if (!stockCode || !/^\d{6}$/.test(stockCode)) {
    return res.status(400).json({ error: '유효한 종목코드 필요' });
  }

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

// --- 서버 시작 ---
const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(MOD, `InvestQuant 서버 시작 - 포트 ${PORT}`);
  logger.info(MOD, `DART API: ${config.dart.apiKey ? '설정됨' : '미설정'}`);
  logger.info(MOD, `auto-trader 연동: ${config.autoTrader.baseUrl}`);
});

module.exports = app;
