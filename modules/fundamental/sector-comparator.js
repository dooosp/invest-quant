const config = require('../../config');
const { loadCache, saveCache } = require('../../utils/file-helper');
const logger = require('../../utils/logger');
const path = require('path');

const MOD = 'Sector';

// 섹터별 기본 벤치마크 (DART 조회 전 fallback)
const SECTOR_BENCHMARKS = {
  TECH:     { per: 15, pbr: 2.0, roe: 12, debtRatio: 60, operatingMargin: 15 },
  FINANCE:  { per: 6,  pbr: 0.5, roe: 8,  debtRatio: 900, operatingMargin: 25 },
  AUTO:     { per: 8,  pbr: 0.8, roe: 10, debtRatio: 120, operatingMargin: 8 },
  BIO:      { per: 30, pbr: 3.0, roe: 5,  debtRatio: 40, operatingMargin: 10 },
  CHEMICAL: { per: 10, pbr: 1.0, roe: 8,  debtRatio: 80, operatingMargin: 10 },
  ENERGY:   { per: 8,  pbr: 0.7, roe: 7,  debtRatio: 100, operatingMargin: 8 },
  DEFAULT:  { per: 12, pbr: 1.2, roe: 10, debtRatio: 80, operatingMargin: 12 },
};

/**
 * 종목의 섹터 벤치마크 조회
 * @param {string} stockCode - 종목코드
 * @returns {object} 섹터 벤치마크
 */
function getSectorBenchmark(stockCode) {
  const sector = config.sectorMap[stockCode] || 'DEFAULT';

  // 동적 섹터 벤치마크 캐시 확인
  const cachePath = path.join(config.dataPath.fundamentals, `_sector_${sector}.json`);
  const cached = loadCache(cachePath, 30); // 30일 캐시
  if (cached && cached.benchmark) {
    return { sector, benchmark: cached.benchmark, source: 'cache' };
  }

  // fallback: 정적 벤치마크
  const benchmark = SECTOR_BENCHMARKS[sector] || SECTOR_BENCHMARKS.DEFAULT;
  return { sector, benchmark, source: 'static' };
}

/**
 * 종목 재무비율을 섹터와 비교
 * @param {string} stockCode - 종목코드
 * @param {object} ratios - 재무비율 (ratio-calculator 결과)
 * @returns {object} 비교 결과
 */
function compareWithSector(stockCode, ratios) {
  if (!ratios) return null;

  const { sector, benchmark, source } = getSectorBenchmark(stockCode);

  const comparison = {};

  // PER: 낮을수록 좋음 (역비교)
  if (ratios.per != null && benchmark.per) {
    const diff = (benchmark.per - ratios.per) / benchmark.per;
    comparison.per = {
      value: ratios.per,
      sectorAvg: benchmark.per,
      diffPct: round(diff * 100),
      verdict: ratios.per < benchmark.per ? 'UNDERVALUED' : 'OVERVALUED',
    };
  }

  // PBR: 낮을수록 좋음 (역비교)
  if (ratios.pbr != null && benchmark.pbr) {
    const diff = (benchmark.pbr - ratios.pbr) / benchmark.pbr;
    comparison.pbr = {
      value: ratios.pbr,
      sectorAvg: benchmark.pbr,
      diffPct: round(diff * 100),
      verdict: ratios.pbr < benchmark.pbr ? 'UNDERVALUED' : 'OVERVALUED',
    };
  }

  // ROE: 높을수록 좋음
  if (ratios.roe != null && benchmark.roe) {
    const diff = (ratios.roe - benchmark.roe) / benchmark.roe;
    comparison.roe = {
      value: ratios.roe,
      sectorAvg: benchmark.roe,
      diffPct: round(diff * 100),
      verdict: ratios.roe > benchmark.roe ? 'ABOVE_AVG' : 'BELOW_AVG',
    };
  }

  // 부채비율: 낮을수록 좋음 (역비교)
  if (ratios.debtRatio != null && benchmark.debtRatio) {
    const diff = (benchmark.debtRatio - ratios.debtRatio) / benchmark.debtRatio;
    comparison.debtRatio = {
      value: ratios.debtRatio,
      sectorAvg: benchmark.debtRatio,
      diffPct: round(diff * 100),
      verdict: ratios.debtRatio < benchmark.debtRatio ? 'STABLE' : 'HIGH_DEBT',
    };
  }

  // 영업이익률: 높을수록 좋음
  if (ratios.operatingMargin != null && benchmark.operatingMargin) {
    const diff = (ratios.operatingMargin - benchmark.operatingMargin) / benchmark.operatingMargin;
    comparison.operatingMargin = {
      value: ratios.operatingMargin,
      sectorAvg: benchmark.operatingMargin,
      diffPct: round(diff * 100),
      verdict: ratios.operatingMargin > benchmark.operatingMargin ? 'ABOVE_AVG' : 'BELOW_AVG',
    };
  }

  logger.info(MOD, `섹터 비교: ${stockCode} (${sector}) - source:${source}`);

  return { sector, comparison, source };
}

/**
 * 섹터 벤치마크 업데이트 (동종 종목들의 재무비율 평균)
 * 주기적으로 호출하여 캐시 갱신
 */
function updateSectorBenchmark(sector, ratiosList) {
  if (!ratiosList || ratiosList.length === 0) return;

  const avg = (arr) => {
    const valid = arr.filter(v => v != null);
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  };

  const benchmark = {
    per: round(avg(ratiosList.map(r => r.per))),
    pbr: round(avg(ratiosList.map(r => r.pbr))),
    roe: round(avg(ratiosList.map(r => r.roe))),
    debtRatio: round(avg(ratiosList.map(r => r.debtRatio))),
    operatingMargin: round(avg(ratiosList.map(r => r.operatingMargin))),
    sampleSize: ratiosList.length,
  };

  const cachePath = path.join(config.dataPath.fundamentals, `_sector_${sector}.json`);
  saveCache(cachePath, { benchmark });
  logger.info(MOD, `섹터 벤치마크 갱신: ${sector} (n=${ratiosList.length})`);
}

function round(v) {
  return v != null ? Math.round(v * 100) / 100 : null;
}

module.exports = { compareWithSector, getSectorBenchmark, updateSectorBenchmark };
