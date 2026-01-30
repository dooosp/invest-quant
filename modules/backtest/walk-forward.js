const { runBacktest } = require('./strategy-engine');
const { calculatePerformance } = require('./performance-calc');
const logger = require('../../utils/logger');

const MOD = 'WalkFwd';

/**
 * Walk-forward 검증
 * - in-sample (70%)에서 전략 검증
 * - out-of-sample (30%)에서 실전 성과 확인
 * - OOS 수익률 > 0이면 전략 유효 판단
 *
 * @param {Array} candles - 전체 OHLCV 데이터
 * @param {object} strategyConfig - 전략 설정
 * @param {number} splitRatio - in-sample 비율 (기본 0.7)
 * @returns {object} { inSample, outOfSample, isValid, degradation }
 */
function walkForwardValidation(candles, strategyConfig = {}, splitRatio = 0.7) {
  if (candles.length < 120) {
    logger.warn(MOD, `데이터 부족: ${candles.length}봉 (최소 120봉 필요)`);
    return { error: '데이터 부족 (최소 120 거래일 필요)' };
  }

  const splitIdx = Math.floor(candles.length * splitRatio);
  const inSampleData = candles.slice(0, splitIdx);
  const outOfSampleData = candles.slice(splitIdx);

  logger.info(MOD, `분할: IS ${inSampleData.length}봉 / OOS ${outOfSampleData.length}봉`);

  // In-sample 백테스트
  const isResult = runBacktest(inSampleData, strategyConfig);
  const isPerf = calculatePerformance(isResult);

  // Out-of-sample 백테스트 (동일 전략)
  const oosResult = runBacktest(outOfSampleData, strategyConfig);
  const oosPerf = calculatePerformance(oosResult);

  // 전략 유효성 판단
  const isValid = oosPerf.totalReturn > 0 && oosPerf.sharpeRatio > 0;

  // 성과 저하율 (IS 대비 OOS)
  const degradation = isPerf.totalReturn !== 0
    ? Math.round(((isPerf.totalReturn - oosPerf.totalReturn) / Math.abs(isPerf.totalReturn)) * 100)
    : 0;

  // 과적합 경고: OOS 성과가 IS의 50% 미만이면
  const isOverfit = isPerf.totalReturn > 0 && degradation > 50;

  const result = {
    inSample: {
      period: `${inSampleData[0]?.date} ~ ${inSampleData[inSampleData.length - 1]?.date}`,
      days: inSampleData.length,
      performance: isPerf,
    },
    outOfSample: {
      period: `${outOfSampleData[0]?.date} ~ ${outOfSampleData[outOfSampleData.length - 1]?.date}`,
      days: outOfSampleData.length,
      performance: oosPerf,
    },
    isValid,
    isOverfit,
    degradation,
    verdict: isOverfit ? 'OVERFIT' : isValid ? 'VALID' : 'INVALID',
  };

  logger.info(MOD, `결과: ${result.verdict} | IS: ${isPerf.totalReturn}% → OOS: ${oosPerf.totalReturn}% (저하 ${degradation}%)`);
  return result;
}

module.exports = { walkForwardValidation };
