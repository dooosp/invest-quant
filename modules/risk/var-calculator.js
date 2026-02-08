const logger = require('../../utils/logger');

const MOD = 'VaR';

/**
 * Historical VaR + CVaR 계산
 * - 일별 수익률 정렬 → 하위 N% 지점 = VaR
 * - CVaR = VaR 이하 수익률의 평균 (Tail Risk)
 *
 * @param {number[]} dailyReturns - 일별 수익률 배열 (예: [0.01, -0.02, ...])
 * @param {number} confidence - 신뢰수준 (0.95 또는 0.99)
 * @returns {object} { var95, var99, cvar95, cvar99, worstDay, avgReturn }
 */
function calculateVaR(dailyReturns, _confidence = 0.95) {
  if (!dailyReturns || dailyReturns.length < 20) {
    logger.warn(MOD, `데이터 부족: ${dailyReturns?.length || 0}일 (최소 20일)`);
    return null;
  }

  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const n = sorted.length;

  // VaR: 하위 (1 - confidence)% 지점
  const idx95 = Math.floor(n * 0.05);
  const idx99 = Math.floor(n * 0.01);

  const var95 = sorted[idx95];
  const var99 = sorted[Math.max(0, idx99)];

  // CVaR (Conditional VaR): VaR 이하 수익률의 평균
  const tail95 = sorted.slice(0, idx95 + 1);
  const tail99 = sorted.slice(0, Math.max(1, idx99 + 1));

  const cvar95 = mean(tail95);
  const cvar99 = mean(tail99);

  const worstDay = sorted[0];
  const avgReturn = mean(dailyReturns);

  const result = {
    var95: round(var95 * 100),       // % 단위
    var99: round(var99 * 100),
    cvar95: round(cvar95 * 100),     // 꼬리 위험
    cvar99: round(cvar99 * 100),
    worstDay: round(worstDay * 100),
    avgReturn: round(avgReturn * 100),
    dataPoints: n,
  };

  logger.info(MOD, `VaR95: ${result.var95}%, VaR99: ${result.var99}%, CVaR95: ${result.cvar95}%`);
  return result;
}

/**
 * 포트폴리오 VaR 계산
 * 가중 합산 방식 (단순화 - 상관계수 미반영)
 * @param {Array} holdings - [{code, weight, dailyReturns}]
 * @returns {object}
 */
function calculatePortfolioVaR(holdings) {
  if (!holdings || holdings.length === 0) return null;

  // 포트폴리오 일별 수익률 = 가중합
  const minLength = Math.min(...holdings.map(h => h.dailyReturns?.length || 0));
  if (minLength < 20) return null;

  const portfolioReturns = [];
  for (let i = 0; i < minLength; i++) {
    let dayReturn = 0;
    for (const h of holdings) {
      dayReturn += (h.dailyReturns[i] || 0) * h.weight;
    }
    portfolioReturns.push(dayReturn);
  }

  return calculateVaR(portfolioReturns);
}

function mean(arr) {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { calculateVaR, calculatePortfolioVaR };
