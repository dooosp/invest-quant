const config = require('../../config');
const { scoreFundamental } = require('../fundamental/fundamental-scorer');
const { fetchDailyCandles } = require('../backtest/data-collector');
const { calculateVaR } = require('../risk/var-calculator');
const { analyzeConcentration } = require('../risk/concentration');
const { calculatePositionSize } = require('../risk/position-sizer');
const logger = require('../../utils/logger');

const MOD = 'Advisory';

// 신뢰도 가중치 (config에서 오버라이드 가능)
const WEIGHTS = config.advisory?.weights || {
  fundamental: 0.4,
  technical: 0.3,
  risk: 0.3,
};

/**
 * 매수 종합 자문
 * @param {object} params
 * @param {string} params.stockCode
 * @param {number} params.currentPrice
 * @param {number} params.technicalScore - auto-trader 기술적 점수 (0~100)
 * @param {Array}  params.holdings - 현재 보유 [{code, name, quantity, currentPrice}]
 * @param {number} params.accountBalance
 * @param {number} params.marketCap
 * @param {number} params.shares
 * @param {number} params.winRate
 * @param {number} params.avgWinLossRatio
 */
async function adviseBuy(params) {
  const { stockCode, currentPrice, technicalScore, holdings, accountBalance, marketCap, shares, winRate, avgWinLossRatio } = params;
  const reasons = [];

  // --- 1. 펀더멘털 ---
  let fundamentalScore = null;
  try {
    const fResult = await scoreFundamental(stockCode, marketCap || null, shares || null);
    fundamentalScore = fResult.score;
    if (fResult.reasons) reasons.push(...fResult.reasons);
  } catch (e) {
    logger.warn(MOD, `펀더멘털 조회 실패: ${stockCode}`);
  }

  const minScore = config.fundamental.minScore;
  if (fundamentalScore != null && fundamentalScore < minScore) {
    logger.info(MOD, `매수 거부: ${stockCode} 펀더멘털 ${fundamentalScore} < ${minScore}`);
    return {
      approved: false, confidence: fundamentalScore,
      fundamentalScore, positionSize: null,
      reason: `펀더멘털 ${fundamentalScore}점 < 기준 ${minScore}점`,
      reasons,
    };
  }

  // --- 2. 리스크 체크 (집중도) ---
  let riskScore = 70; // 기본값
  if (holdings && holdings.length > 0) {
    const holdingsWithValue = holdings.map(h => ({
      code: h.code, name: h.name,
      value: h.quantity * (h.currentPrice || 0),
    }));
    const conc = analyzeConcentration(holdingsWithValue);

    // 동일 섹터 집중 + 높은 HHI → 감점
    const newSector = config.sectorMap[stockCode] || 'UNKNOWN';
    const sectorPct = conc.sectorConcentration[newSector] || 0;

    if (conc.level === 'HIGHLY_CONCENTRATED' && sectorPct > 30) {
      logger.info(MOD, `매수 거부: ${stockCode} 집중도 위험 (HHI:${conc.hhi}, 섹터 ${newSector}:${sectorPct}%)`);
      return {
        approved: false, confidence: 20,
        fundamentalScore, positionSize: null,
        reason: `포트폴리오 집중도 위험 (HHI:${conc.hhi}, ${newSector} 섹터 ${sectorPct}%)`,
        reasons: [...reasons, `집중도 ${conc.level}`],
      };
    }

    if (conc.level === 'CONCENTRATED') riskScore = 50;
    else if (conc.level === 'MODERATE') riskScore = 65;
    else riskScore = 85;
  }

  // --- 3. 포지션 사이징 ---
  let positionSize = null;
  if (accountBalance && currentPrice) {
    const candles = await fetchDailyCandles(stockCode, 60).catch(() => []);
    const sizing = calculatePositionSize({
      accountBalance,
      defaultBuyAmount: 500000,
      winRate: winRate || null,
      avgWinLossRatio: avgWinLossRatio || null,
      candles: candles.length > 15 ? candles : null,
      currentPrice,
    });
    positionSize = sizing.positionSize;
    if (sizing.reasons) reasons.push(...sizing.reasons);
  }

  // --- 4. 종합 신뢰도 ---
  const fNorm = fundamentalScore != null ? fundamentalScore : 50;
  const tNorm = technicalScore != null ? technicalScore : 50;
  const confidence = Math.round(
    fNorm * WEIGHTS.fundamental + tNorm * WEIGHTS.technical + riskScore * WEIGHTS.risk
  );

  logger.info(MOD, `매수 승인: ${stockCode} 신뢰도 ${confidence} (F:${fNorm} T:${tNorm} R:${riskScore}) 포지션:${positionSize || 'N/A'}`);

  return {
    approved: true,
    confidence,
    fundamentalScore,
    positionSize,
    reason: `종합 신뢰도 ${confidence}점 (펀더멘털 ${fNorm} × ${WEIGHTS.fundamental} + 기술 ${tNorm} × ${WEIGHTS.technical} + 리스크 ${riskScore} × ${WEIGHTS.risk})`,
    reasons,
  };
}

/**
 * 매도 종합 자문
 * @param {object} params
 * @param {string} params.stockCode
 * @param {number} params.currentPrice
 * @param {number} params.avgPrice
 * @param {number} params.profitRate
 * @param {string} params.reason - 매도 사유
 * @param {boolean} params.isUrgent - 긴급매도 여부
 */
async function adviseSell(params) {
  const { stockCode, currentPrice, avgPrice, profitRate, reason, isUrgent } = params;

  // 긴급매도 → 항상 승인 (bypass)
  if (isUrgent) {
    logger.info(MOD, `매도 승인 (긴급): ${stockCode} - ${reason}`);
    return { approved: true, urgentBypass: true, reason: `긴급매도: ${reason}` };
  }

  const reasons = [];

  // 펀더멘털 체크 (캐시 활용, 새 API 호출 최소화)
  let sellRecommendation = 'NEUTRAL';
  try {
    const fResult = await scoreFundamental(stockCode, null, null);
    if (fResult.score != null && fResult.score < 30) {
      sellRecommendation = 'STRONG_SELL';
      reasons.push(`펀더멘털 악화 (${fResult.score}점) → 매도 권고 강화`);
    } else if (fResult.score != null && fResult.score < 50) {
      sellRecommendation = 'SELL';
      reasons.push(`펀더멘털 약화 (${fResult.score}점)`);
    }
  } catch (e) {
    // 실패 시 기술적 신호 존중
  }

  // 기술적 매도 신호 + 펀더멘털 약화 → 강력 승인
  // 기술적 매도 신호 + 펀더멘털 양호 → 일반 승인 (기술 존중)
  logger.info(MOD, `매도 승인: ${stockCode} (수익률:${((profitRate || 0) * 100).toFixed(1)}%, 펀더멘털:${sellRecommendation})`);

  return {
    approved: true,
    urgentBypass: false,
    sellRecommendation,
    reason: `매도 자문: ${reason || '기술적 신호'}`,
    reasons,
  };
}

module.exports = { adviseBuy, adviseSell };
