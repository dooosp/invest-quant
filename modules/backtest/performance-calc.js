const logger = require('../../utils/logger');

const MOD = 'Perf';

/**
 * 백테스트 성과 지표 계산
 * @param {object} backtestResult - runBacktest() 결과
 * @returns {object} 성과 지표
 */
function calculatePerformance(backtestResult) {
  const { trades, equityCurve, finalValue, initialCapital } = backtestResult;

  if (!equityCurve || equityCurve.length < 2) {
    return { error: '데이터 부족' };
  }

  // --- 기본 수익률 ---
  const totalReturn = (finalValue - initialCapital) / initialCapital;

  // --- 일별 수익률 ---
  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    if (prev > 0) {
      dailyReturns.push((equityCurve[i].value - prev) / prev);
    }
  }

  // --- Sharpe Ratio (연환산, 무위험수익률 3.5%) ---
  const riskFreeDaily = 0.035 / 252;
  const excessReturns = dailyReturns.map(r => r - riskFreeDaily);
  const avgExcess = mean(excessReturns);
  const stdExcess = stdDev(excessReturns);
  const sharpeRatio = stdExcess > 0 ? (avgExcess / stdExcess) * Math.sqrt(252) : 0;

  // --- Sortino Ratio (하방 변동성만) ---
  const downside = excessReturns.filter(r => r < 0);
  const downsideDev = stdDev(downside);
  const sortinoRatio = downsideDev > 0 ? (avgExcess / downsideDev) * Math.sqrt(252) : 0;

  // --- Max Drawdown ---
  let peak = equityCurve[0].value;
  let maxDrawdown = 0;
  let maxDrawdownDate = '';
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownDate = point.date;
    }
  }

  // --- 매매 통계 ---
  const sellTrades = trades.filter(t => t.type === 'SELL' || t.type === 'PARTIAL_SELL');
  const winTrades = sellTrades.filter(t => t.profitRate > 0);
  const lossTrades = sellTrades.filter(t => t.profitRate <= 0);

  const winRate = sellTrades.length > 0 ? winTrades.length / sellTrades.length : 0;

  // --- Profit Factor ---
  const grossProfit = winTrades.reduce((s, t) => s + t.profitRate, 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.profitRate, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // --- 평균 수익/손실 ---
  const avgWin = winTrades.length > 0 ? mean(winTrades.map(t => t.profitRate)) : 0;
  const avgLoss = lossTrades.length > 0 ? mean(lossTrades.map(t => t.profitRate)) : 0;

  const result = {
    totalReturn: round(totalReturn * 100),
    annualizedReturn: round(annualize(totalReturn, equityCurve.length) * 100),
    sharpeRatio: round(sharpeRatio),
    sortinoRatio: round(sortinoRatio),
    maxDrawdown: round(maxDrawdown * 100),
    maxDrawdownDate,
    winRate: round(winRate * 100),
    profitFactor: round(profitFactor),
    totalTrades: trades.filter(t => t.type === 'BUY').length,
    sellTrades: sellTrades.length,
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    finalValue: Math.round(finalValue),
    initialCapital,
  };

  logger.info(MOD, `성과: 수익 ${result.totalReturn}%, Sharpe ${result.sharpeRatio}, MDD ${result.maxDrawdown}%, WR ${result.winRate}%`);
  return result;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function annualize(totalReturn, tradingDays) {
  if (tradingDays <= 0) return 0;
  return Math.pow(1 + totalReturn, 252 / tradingDays) - 1;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { calculatePerformance };
