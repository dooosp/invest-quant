const logger = require('../../utils/logger');

const MOD = 'Corr';

/**
 * 피어슨 상관계수 계산
 * @param {number[]} x - 수익률 배열 A
 * @param {number[]} y - 수익률 배열 B
 * @returns {number} -1 ~ +1
 */
function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return null;

  const xSlice = x.slice(-n);
  const ySlice = y.slice(-n);

  const meanX = xSlice.reduce((s, v) => s + v, 0) / n;
  const meanY = ySlice.reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - meanX;
    const dy = ySlice[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return 0;
  return Math.round((sumXY / denom) * 1000) / 1000;
}

/**
 * 상관계수 매트릭스 생성
 * 전체 기간 + 최근 60일 단기 상관계수 병렬 계산
 *
 * @param {Array} stocks - [{code, dailyReturns}]
 * @returns {object} { full: {matrix, highPairs}, short: {matrix, highPairs} }
 */
function buildCorrelationMatrix(stocks) {
  if (!stocks || stocks.length < 2) return null;

  const fullMatrix = {};
  const shortMatrix = {};
  const highPairsFull = [];
  const highPairsShort = [];

  for (let i = 0; i < stocks.length; i++) {
    for (let j = i + 1; j < stocks.length; j++) {
      const a = stocks[i];
      const b = stocks[j];
      const pairKey = `${a.code}-${b.code}`;

      // 전체 기간 상관계수
      const corrFull = pearsonCorrelation(a.dailyReturns, b.dailyReturns);
      fullMatrix[pairKey] = corrFull;

      if (corrFull != null && Math.abs(corrFull) >= 0.8) {
        highPairsFull.push({ pair: pairKey, correlation: corrFull, level: 'FULL' });
      }

      // 최근 60일 단기 상관계수
      const shortA = a.dailyReturns.slice(-60);
      const shortB = b.dailyReturns.slice(-60);
      const corrShort = pearsonCorrelation(shortA, shortB);
      shortMatrix[pairKey] = corrShort;

      if (corrShort != null && Math.abs(corrShort) >= 0.8) {
        highPairsShort.push({ pair: pairKey, correlation: corrShort, level: 'SHORT_60D' });
      }
    }
  }

  const allHighPairs = [...highPairsFull, ...highPairsShort];
  if (allHighPairs.length > 0) {
    logger.warn(MOD, `높은 상관관계 ${allHighPairs.length}쌍 감지`);
  }

  return {
    full: { matrix: fullMatrix, highPairs: highPairsFull },
    short: { matrix: shortMatrix, highPairs: highPairsShort },
    warnings: allHighPairs,
    stockCount: stocks.length,
  };
}

module.exports = { pearsonCorrelation, buildCorrelationMatrix };
