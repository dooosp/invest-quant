const config = require('../../config');
const { getRecentFinancials } = require('./dart-client');
const { calculateRatios } = require('./ratio-calculator');
const { compareWithSector } = require('./sector-comparator');
const logger = require('../../utils/logger');

const MOD = 'Scorer';
const W = config.fundamental.weights;

/**
 * 종목 펀더멘털 종합 점수 산출 (0-100)
 *
 * 배점:
 * - 밸류에이션 (30점): PER, PBR 섹터 대비
 * - 수익성 (30점): ROE, 영업이익률
 * - 안정성 (20점): 부채비율, 유동비율
 * - 성장성 (20점): 매출성장률, 영업이익성장률
 *
 * @param {string} stockCode - 종목코드
 * @param {number} marketCap - 시가총액
 * @param {number} sharesOutstanding - 발행주식수
 * @returns {object} { score, breakdown, ratios, sectorComparison, reasons }
 */
async function scoreFundamental(stockCode, marketCap, sharesOutstanding) {
  const financials = await getRecentFinancials(stockCode);
  if (!financials.current) {
    logger.warn(MOD, `재무제표 없음: ${stockCode} - 점수 산출 불가`);
    return {
      score: null,
      available: false,
      reason: '재무제표 미공시',
    };
  }

  const ratios = calculateRatios(
    financials.current,
    financials.previous,
    marketCap,
    sharesOutstanding
  );

  if (!ratios) {
    return { score: null, available: false, reason: '비율 계산 실패' };
  }

  const sectorResult = compareWithSector(stockCode, ratios);
  const comparison = sectorResult ? sectorResult.comparison : {};

  // --- 밸류에이션 점수 (30점) ---
  const valuationScore = scoreValuation(ratios, comparison);

  // --- 수익성 점수 (30점) ---
  const profitabilityScore = scoreProfitability(ratios, comparison);

  // --- 안정성 점수 (20점) ---
  const stabilityScore = scoreStability(ratios);

  // --- 성장성 점수 (20점) ---
  const growthScore = scoreGrowth(ratios);

  const totalScore = Math.round(
    valuationScore.score + profitabilityScore.score +
    stabilityScore.score + growthScore.score
  );

  const reasons = [
    ...valuationScore.reasons,
    ...profitabilityScore.reasons,
    ...stabilityScore.reasons,
    ...growthScore.reasons,
  ];

  logger.info(MOD, `${stockCode} 점수: ${totalScore}/100 (V:${valuationScore.score} P:${profitabilityScore.score} S:${stabilityScore.score} G:${growthScore.score})`);

  return {
    score: totalScore,
    available: true,
    breakdown: {
      valuation: valuationScore.score,
      profitability: profitabilityScore.score,
      stability: stabilityScore.score,
      growth: growthScore.score,
    },
    ratios,
    sectorComparison: sectorResult,
    reasons,
    year: financials.year,
  };
}

/**
 * 밸류에이션 점수 (최대 30점)
 * PER, PBR을 섹터 평균과 비교
 */
function scoreValuation(ratios, comparison) {
  let score = 0;
  const reasons = [];
  const max = W.valuation; // 30

  // PER (15점)
  if (ratios.per != null) {
    if (ratios.per < 0) {
      // 적자 기업
      score += 0;
      reasons.push('PER 음수 (적자)');
    } else if (comparison.per) {
      const { verdict, diffPct } = comparison.per;
      if (verdict === 'UNDERVALUED') {
        score += Math.min(15, 7.5 + diffPct * 0.15);
        reasons.push(`PER ${ratios.per} (섹터대비 ${diffPct > 0 ? '+' : ''}${diffPct.toFixed(0)}% 저평가)`);
      } else {
        score += Math.max(0, 7.5 - Math.abs(diffPct) * 0.1);
        reasons.push(`PER ${ratios.per} (섹터대비 고평가)`);
      }
    } else {
      // 섹터 비교 불가 → 절대값 기준
      score += ratios.per <= 10 ? 12 : ratios.per <= 20 ? 8 : ratios.per <= 30 ? 4 : 0;
    }
  }

  // PBR (15점)
  if (ratios.pbr != null) {
    if (ratios.pbr < 0) {
      score += 0;
      reasons.push('PBR 음수 (자본잠식)');
    } else if (comparison.pbr) {
      const { verdict, diffPct } = comparison.pbr;
      if (verdict === 'UNDERVALUED') {
        score += Math.min(15, 7.5 + diffPct * 0.15);
        reasons.push(`PBR ${ratios.pbr} (섹터대비 저평가)`);
      } else {
        score += Math.max(0, 7.5 - Math.abs(diffPct) * 0.1);
        reasons.push(`PBR ${ratios.pbr} (섹터대비 고평가)`);
      }
    } else {
      score += ratios.pbr <= 1.0 ? 12 : ratios.pbr <= 2.0 ? 8 : ratios.pbr <= 3.0 ? 4 : 0;
    }
  }

  return { score: Math.min(max, Math.round(score * 10) / 10), reasons };
}

/**
 * 수익성 점수 (최대 30점)
 * ROE, 영업이익률
 */
function scoreProfitability(ratios, _comparison) {
  let score = 0;
  const reasons = [];
  const max = W.profitability; // 30

  // ROE (15점)
  if (ratios.roe != null) {
    if (ratios.roe >= 20) { score += 15; reasons.push(`ROE ${ratios.roe}% (우수)`); }
    else if (ratios.roe >= 15) { score += 12; reasons.push(`ROE ${ratios.roe}% (양호)`); }
    else if (ratios.roe >= 10) { score += 9; reasons.push(`ROE ${ratios.roe}%`); }
    else if (ratios.roe >= 5) { score += 5; reasons.push(`ROE ${ratios.roe}% (저조)`); }
    else if (ratios.roe > 0) { score += 2; reasons.push(`ROE ${ratios.roe}% (미흡)`); }
    else { score += 0; reasons.push(`ROE ${ratios.roe}% (적자)`); }
  }

  // 영업이익률 (15점)
  if (ratios.operatingMargin != null) {
    if (ratios.operatingMargin >= 20) { score += 15; reasons.push(`영업이익률 ${ratios.operatingMargin}% (우수)`); }
    else if (ratios.operatingMargin >= 15) { score += 12; }
    else if (ratios.operatingMargin >= 10) { score += 9; }
    else if (ratios.operatingMargin >= 5) { score += 5; }
    else if (ratios.operatingMargin > 0) { score += 2; reasons.push(`영업이익률 ${ratios.operatingMargin}% (저조)`); }
    else { score += 0; reasons.push(`영업이익률 ${ratios.operatingMargin}% (적자)`); }
  }

  return { score: Math.min(max, Math.round(score * 10) / 10), reasons };
}

/**
 * 안정성 점수 (최대 20점)
 * 부채비율, 유동비율
 */
function scoreStability(ratios) {
  let score = 0;
  const reasons = [];
  const max = W.stability; // 20

  // 부채비율 (10점) - 낮을수록 좋음
  if (ratios.debtRatio != null) {
    if (ratios.debtRatio <= 50) { score += 10; }
    else if (ratios.debtRatio <= 100) { score += 8; }
    else if (ratios.debtRatio <= 150) { score += 5; }
    else if (ratios.debtRatio <= 200) { score += 2; reasons.push(`부채비율 ${ratios.debtRatio}% (주의)`); }
    else { score += 0; reasons.push(`부채비율 ${ratios.debtRatio}% (위험)`); }
  }

  // 유동비율 (10점) - 높을수록 좋음
  if (ratios.currentRatio != null) {
    if (ratios.currentRatio >= 200) { score += 10; }
    else if (ratios.currentRatio >= 150) { score += 8; }
    else if (ratios.currentRatio >= 100) { score += 5; }
    else if (ratios.currentRatio >= 50) { score += 2; reasons.push(`유동비율 ${ratios.currentRatio}% (주의)`); }
    else { score += 0; reasons.push(`유동비율 ${ratios.currentRatio}% (위험)`); }
  }

  return { score: Math.min(max, Math.round(score * 10) / 10), reasons };
}

/**
 * 성장성 점수 (최대 20점)
 * 매출성장률, 영업이익성장률
 */
function scoreGrowth(ratios) {
  let score = 0;
  const reasons = [];
  const max = W.growth; // 20

  // 매출성장률 (10점)
  if (ratios.revenueGrowth != null) {
    if (ratios.revenueGrowth >= 20) { score += 10; reasons.push(`매출성장 +${ratios.revenueGrowth}%`); }
    else if (ratios.revenueGrowth >= 10) { score += 8; }
    else if (ratios.revenueGrowth >= 5) { score += 6; }
    else if (ratios.revenueGrowth >= 0) { score += 3; }
    else { score += 0; reasons.push(`매출 역성장 ${ratios.revenueGrowth}%`); }
  }

  // 영업이익성장률 (10점)
  if (ratios.operatingProfitGrowth != null) {
    if (ratios.operatingProfitGrowth >= 30) { score += 10; reasons.push(`영업이익성장 +${ratios.operatingProfitGrowth}%`); }
    else if (ratios.operatingProfitGrowth >= 15) { score += 8; }
    else if (ratios.operatingProfitGrowth >= 5) { score += 5; }
    else if (ratios.operatingProfitGrowth >= 0) { score += 3; }
    else { score += 0; reasons.push(`영업이익 감소 ${ratios.operatingProfitGrowth}%`); }
  }

  return { score: Math.min(max, Math.round(score * 10) / 10), reasons };
}

module.exports = { scoreFundamental };
