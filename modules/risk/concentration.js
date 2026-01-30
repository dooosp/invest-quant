const config = require('../../config');
const logger = require('../../utils/logger');

const MOD = 'Conc';

/**
 * 포트폴리오 집중도 분석
 * - HHI (허핀달-허시만 지수): 종목별 비중의 제곱합
 * - 섹터 집중도: 섹터별 비중
 *
 * @param {Array} holdings - [{code, name, value}] (value = 현재 평가금액)
 * @returns {object}
 */
function analyzeConcentration(holdings) {
  if (!holdings || holdings.length === 0) {
    return { hhi: 0, level: 'EMPTY', sectorConcentration: {} };
  }

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  if (totalValue <= 0) return { hhi: 0, level: 'EMPTY', sectorConcentration: {} };

  // --- HHI (0~10000) ---
  // 10000 = 단일 종목 100%, <1500 = 분산됨, >2500 = 집중됨
  let hhi = 0;
  const stockWeights = [];

  for (const h of holdings) {
    const weight = h.value / totalValue;
    hhi += Math.pow(weight * 100, 2); // %단위 제곱합
    stockWeights.push({ code: h.code, name: h.name, weight: round(weight * 100) });
  }
  hhi = Math.round(hhi);

  let level = 'DIVERSIFIED';
  if (hhi >= 4000) level = 'HIGHLY_CONCENTRATED';
  else if (hhi >= 2500) level = 'CONCENTRATED';
  else if (hhi >= 1500) level = 'MODERATE';

  // --- 섹터 집중도 ---
  const sectorValues = {};
  for (const h of holdings) {
    const sector = config.sectorMap[h.code] || 'UNKNOWN';
    sectorValues[sector] = (sectorValues[sector] || 0) + h.value;
  }

  const sectorConcentration = {};
  const sectorWarnings = [];
  for (const [sector, value] of Object.entries(sectorValues)) {
    const pct = round((value / totalValue) * 100);
    sectorConcentration[sector] = pct;
    if (pct > 40) {
      sectorWarnings.push({ sector, pct, level: 'HIGH' });
    } else if (pct > 30) {
      sectorWarnings.push({ sector, pct, level: 'MODERATE' });
    }
  }

  // --- 최대 단일 종목 비중 ---
  const maxStock = stockWeights.reduce((max, s) => s.weight > max.weight ? s : max, { weight: 0 });
  const singleStockWarning = maxStock.weight > 20
    ? { code: maxStock.code, name: maxStock.name, weight: maxStock.weight, level: maxStock.weight > 30 ? 'HIGH' : 'MODERATE' }
    : null;

  if (level !== 'DIVERSIFIED') {
    logger.warn(MOD, `집중도 경고: HHI=${hhi} (${level})`);
  }

  return {
    hhi,
    level,
    stockWeights,
    sectorConcentration,
    sectorWarnings,
    singleStockWarning,
    totalValue: Math.round(totalValue),
    holdingCount: holdings.length,
  };
}

function round(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { analyzeConcentration };
