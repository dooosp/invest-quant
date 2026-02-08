const _logger = require('../../utils/logger');

const _MOD = 'Strategy';

// =============================================
// 1. 기술 지표 계산 (auto-trader indicators.js 재현)
// =============================================

function SMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((s, p) => s + p, 0) / period;
}

function EMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = SMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function RSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  const recent = changes.slice(-period);
  let gains = 0, losses = 0;
  for (const c of recent) {
    if (c > 0) gains += c; else losses += Math.abs(c);
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / avgLoss));
}

function MACD(prices, fast = 12, slow = 26, sig = 9) {
  if (prices.length < slow + sig) return { macd: null, signal: null, histogram: null, trend: 'NEUTRAL', crossover: null };
  const emaFast = EMAArray(prices, fast);
  const emaSlow = EMAArray(prices, slow);
  const offset = slow - fast;
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) macdLine.push(emaFast[i + offset] - emaSlow[i]);
  const signalLine = EMAArray(macdLine, sig);
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  const pm = macdLine[macdLine.length - 2];
  const ps = signalLine[signalLine.length - 2];
  let trend = 'NEUTRAL', crossover = null;
  if (pm <= ps && m > s) { trend = 'BULLISH'; crossover = 'GOLDEN_CROSS'; }
  else if (pm >= ps && m < s) { trend = 'BEARISH'; crossover = 'DEAD_CROSS'; }
  else if (m > s) { trend = 'BULLISH'; }
  else if (m < s) { trend = 'BEARISH'; }
  return { macd: m, signal: s, histogram: m - s, trend, crossover };
}

function EMAArray(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = [prices.slice(0, period).reduce((s, p) => s + p, 0) / period];
  for (let i = period; i < prices.length; i++) {
    result.push(prices[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function BollingerBands(prices, period = 20, mult = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null, percentB: null, signal: 'NEUTRAL' };
  const middle = SMA(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((s, p) => s + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDev * mult;
  const lower = middle - stdDev * mult;
  const current = prices[prices.length - 1];
  const percentB = (current - lower) / (upper - lower);
  let signal = 'NEUTRAL';
  if (percentB >= 1) signal = 'OVERBOUGHT';
  else if (percentB <= 0) signal = 'OVERSOLD';
  else if (percentB > 0.8) signal = 'UPPER_ZONE';
  else if (percentB < 0.2) signal = 'LOWER_ZONE';
  return { upper, middle, lower, percentB, signal };
}

function Stochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod + dPeriod) return { k: null, d: null, signal: 'NEUTRAL', crossover: null };
  const kValues = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...slice.map(c => c.high));
    const lo = Math.min(...slice.map(c => c.low));
    kValues.push(hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100);
  }
  const dValues = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    dValues.push(kValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
  }
  const k = kValues[kValues.length - 1];
  const d = dValues[dValues.length - 1];
  const pk = kValues[kValues.length - 2];
  const pd = dValues[dValues.length - 2];
  let signal = 'NEUTRAL', crossover = null;
  if (k < 20) signal = 'OVERSOLD';
  else if (k > 80) signal = 'OVERBOUGHT';
  if (pk <= pd && k > d && k < 30) crossover = 'BULLISH_CROSS';
  else if (pk >= pd && k < d && k > 70) crossover = 'BEARISH_CROSS';
  return { k, d, signal, crossover };
}

function ATR(candles, period = 14) {
  if (candles.length < period + 1) return { atr: null, atrPercent: null };
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  const atr = trs.slice(-period).reduce((s, v) => s + v, 0) / period;
  return { atr, atrPercent: (atr / candles[candles.length - 1].close) * 100 };
}

function VolumeAnalysis(candles, period = 20) {
  if (candles.length < period) return { volumeRatio: null, signal: 'NEUTRAL' };
  const vols = candles.map(c => c.volume);
  const avg = SMA(vols.slice(0, -1), period);
  const cur = vols[vols.length - 1];
  const ratio = avg ? cur / avg : 1;
  const today = candles[candles.length - 1];
  const isGreen = today.close > today.open;
  let signal = 'NEUTRAL';
  if (ratio >= 2.0) signal = isGreen ? 'STRONG_BUYING' : 'STRONG_SELLING';
  else if (ratio >= 1.5) signal = isGreen ? 'BUYING_PRESSURE' : 'SELLING_PRESSURE';
  return { volumeRatio: ratio, signal };
}

// =============================================
// 2. 매매 신호 생성 (auto-trader confluence 재현)
// =============================================

function generateSignals(candles, idx, strategyConfig) {
  const window = candles.slice(0, idx + 1);
  const closes = window.map(c => c.close);
  const current = closes[closes.length - 1];
  if (closes.length < 60) return { buy: 0, sell: 0, signal: 'NEUTRAL' };

  const rsi = RSI(closes);
  const macd = MACD(closes);
  const bb = BollingerBands(closes);
  const stoch = Stochastic(window);
  const atr = ATR(window);
  const vol = VolumeAnalysis(window);
  const ma5 = SMA(closes, 5);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);

  let buyScore = 0, sellScore = 0;

  // RSI
  if (rsi != null) {
    if (rsi < 30) buyScore += 2; else if (rsi < 40) buyScore += 1;
    if (rsi > 75) sellScore += 2; else if (rsi > 60) sellScore += 1;
  }
  // MACD
  if (macd.crossover === 'GOLDEN_CROSS') buyScore += 2;
  else if (macd.trend === 'BULLISH') buyScore += 1;
  if (macd.crossover === 'DEAD_CROSS') sellScore += 2;
  else if (macd.trend === 'BEARISH') sellScore += 1;
  // Bollinger
  if (bb.signal === 'OVERSOLD') buyScore += 2; else if (bb.signal === 'LOWER_ZONE') buyScore += 1;
  if (bb.signal === 'OVERBOUGHT') sellScore += 2; else if (bb.signal === 'UPPER_ZONE') sellScore += 1;
  // Volume
  if (vol.signal === 'STRONG_BUYING') buyScore += 2; else if (vol.signal === 'BUYING_PRESSURE') buyScore += 1;
  if (vol.signal === 'STRONG_SELLING') sellScore += 2; else if (vol.signal === 'SELLING_PRESSURE') sellScore += 1;
  // MA alignment
  if (ma5 && ma20 && ma60 && ma5 > ma20 && ma20 > ma60) buyScore += 1;
  if (ma5 && ma20 && current > ma5 && current > ma20) buyScore += 1;
  else if (ma5 && ma20 && current < ma5 && current < ma20) sellScore += 1;
  // Stochastic
  if (stoch.signal === 'OVERSOLD') buyScore += 1;
  if (stoch.crossover === 'BULLISH_CROSS') buyScore += 1;
  if (stoch.signal === 'OVERBOUGHT') sellScore += 1;
  if (stoch.crossover === 'BEARISH_CROSS') sellScore += 1;

  const reqBuy = strategyConfig.requiredBuyConditions || 5;
  const reqSell = strategyConfig.requiredSellConditions || 3;

  let signal = 'NEUTRAL';
  if (buyScore >= reqBuy) signal = 'BUY';
  if (sellScore >= reqSell) signal = 'SELL';

  return { buy: buyScore, sell: sellScore, signal, rsi, macd: macd.trend, atr };
}

// =============================================
// 3. 백테스트 시뮬레이션
// =============================================

/**
 * 단일 종목 백테스트 실행
 * @param {Array} candles - OHLCV 데이터
 * @param {object} strategyConfig - 전략 설정
 * @returns {object} { trades, equity, finalValue }
 */
function runBacktest(candles, strategyConfig = {}) {
  const {
    initialCapital = 10000000,
    buyAmount = 500000,
    stopLoss = -0.05,
    takeProfit = 0.10,
    slippage = 0.001,       // 0.1% 슬리피지
    commission = 0.00015,   // 0.015% 수수료 (매수+매도)
    requiredBuyConditions = 5,
    requiredSellConditions = 3,
    partialSellLevels = [
      { profitRate: 0.05, sellRatio: 0.3 },
      { profitRate: 0.10, sellRatio: 0.3 },
      { profitRate: 0.15, sellRatio: 0.4 },
    ],
  } = strategyConfig;

  let cash = initialCapital;
  let position = null; // { qty, avgPrice, buyDate, partialSold: [] }
  const trades = [];
  const equityCurve = [];
  const warmup = 60; // 지표 계산 워밍업

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close;

    // 현재 포트폴리오 가치
    const positionValue = position ? position.qty * price : 0;
    equityCurve.push({ date: candle.date, value: cash + positionValue });

    const signals = generateSignals(candles, i, { requiredBuyConditions, requiredSellConditions });

    // --- 보유 중 → 매도 판단 ---
    if (position) {
      const profitRate = (price - position.avgPrice) / position.avgPrice;
      const isStopLoss = profitRate <= stopLoss;
      const isTakeProfit = profitRate >= takeProfit;

      // 분할 매도 체크
      let _partialSold = false;
      for (const level of partialSellLevels) {
        const levelId = `L${Math.round(level.profitRate * 100)}`;
        if (profitRate >= level.profitRate && !position.partialSold.includes(levelId)) {
          const sellQty = Math.max(1, Math.floor(position.qty * level.sellRatio));
          if (sellQty > 0 && position.qty > sellQty) {
            const execPrice = price * (1 - slippage);
            const proceeds = sellQty * execPrice * (1 - commission);
            cash += proceeds;
            position.qty -= sellQty;
            position.partialSold.push(levelId);
            trades.push({
              type: 'PARTIAL_SELL', date: candle.date,
              qty: sellQty, price: Math.round(execPrice),
              profitRate: Math.round(profitRate * 10000) / 100,
              reason: `분할매도 +${Math.round(level.profitRate * 100)}%`,
            });
            _partialSold = true;
          }
        }
      }

      // 손절 / 전량 매도
      if (isStopLoss || isTakeProfit || signals.signal === 'SELL') {
        const execPrice = price * (1 - slippage);
        const proceeds = position.qty * execPrice * (1 - commission);
        cash += proceeds;
        const reason = isStopLoss ? '손절' : isTakeProfit ? '익절' : '신호매도';
        trades.push({
          type: 'SELL', date: candle.date,
          qty: position.qty, price: Math.round(execPrice),
          profitRate: Math.round(profitRate * 10000) / 100,
          reason,
        });
        position = null;
      }
    }

    // --- 미보유 → 매수 판단 ---
    if (!position && signals.signal === 'BUY') {
      const execPrice = price * (1 + slippage);
      const cost = buyAmount * (1 + commission);
      if (cash >= cost) {
        const qty = Math.floor(buyAmount / execPrice);
        if (qty >= 1) {
          cash -= qty * execPrice * (1 + commission);
          position = { qty, avgPrice: execPrice, buyDate: candle.date, partialSold: [] };
          trades.push({
            type: 'BUY', date: candle.date,
            qty, price: Math.round(execPrice),
          });
        }
      }
    }
  }

  // 잔여 포지션 평가
  const lastPrice = candles[candles.length - 1].close;
  const finalValue = cash + (position ? position.qty * lastPrice : 0);

  return { trades, equityCurve, finalValue, initialCapital };
}

module.exports = { runBacktest, generateSignals, RSI, MACD, SMA, EMA, BollingerBands, Stochastic, ATR };
