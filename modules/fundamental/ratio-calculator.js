const { extractAmount } = require('./dart-client');
const logger = require('../../utils/logger');

const MOD = 'Ratio';

/**
 * DART 재무제표에서 주요 재무비율 계산
 * @param {Array} currentStatements - 당기 재무제표
 * @param {Array} previousStatements - 전기 재무제표 (성장률 계산용)
 * @param {number} marketCap - 시가총액 (원) - 외부에서 전달
 * @param {number} sharesOutstanding - 발행주식수
 * @returns {object} 재무비율 객체
 */
function calculateRatios(currentStatements, previousStatements, marketCap, sharesOutstanding) {
  if (!currentStatements) {
    logger.warn(MOD, '재무제표 없음 - 비율 계산 불가');
    return null;
  }

  // --- 손익계산서(IS) 항목 ---
  const revenue = extractAmount(currentStatements, '매출액', 'IS')
    || extractAmount(currentStatements, '수익(매출액)', 'IS');
  const operatingProfit = extractAmount(currentStatements, '영업이익', 'IS')
    || extractAmount(currentStatements, '영업손익', 'IS');
  const netIncome = extractAmount(currentStatements, '당기순이익', 'IS')
    || extractAmount(currentStatements, '당기순손익', 'IS');

  // --- 재무상태표(BS) 항목 ---
  const totalAssets = extractAmount(currentStatements, '자산총계', 'BS');
  const totalLiabilities = extractAmount(currentStatements, '부채총계', 'BS');
  const totalEquity = extractAmount(currentStatements, '자본총계', 'BS');
  const currentAssets = extractAmount(currentStatements, '유동자산', 'BS');
  const currentLiabilities = extractAmount(currentStatements, '유동부채', 'BS');

  // --- 현금흐름표(CF) 항목 ---
  const operatingCF = extractAmount(currentStatements, '영업활동', 'CF');
  const investingCF = extractAmount(currentStatements, '투자활동', 'CF');

  // --- 전기 항목 (성장률용) ---
  const prevRevenue = previousStatements
    ? (extractAmount(previousStatements, '매출액', 'IS')
      || extractAmount(previousStatements, '수익(매출액)', 'IS'))
    : null;
  const prevOperatingProfit = previousStatements
    ? (extractAmount(previousStatements, '영업이익', 'IS')
      || extractAmount(previousStatements, '영업손익', 'IS'))
    : null;

  // --- 비율 계산 ---
  const ratios = {
    // 밸류에이션
    per: safeDiv(marketCap, netIncome),
    pbr: safeDiv(marketCap, totalEquity),
    eps: safeDiv(netIncome, sharesOutstanding),
    bps: safeDiv(totalEquity, sharesOutstanding),

    // 수익성
    roe: safePct(netIncome, totalEquity),
    roa: safePct(netIncome, totalAssets),
    operatingMargin: safePct(operatingProfit, revenue),
    netMargin: safePct(netIncome, revenue),

    // 안정성
    debtRatio: safePct(totalLiabilities, totalEquity),
    currentRatio: safePct(currentAssets, currentLiabilities),

    // 성장성
    revenueGrowth: prevRevenue ? safePct(revenue - prevRevenue, Math.abs(prevRevenue)) : null,
    operatingProfitGrowth: prevOperatingProfit
      ? safePct(operatingProfit - prevOperatingProfit, Math.abs(prevOperatingProfit))
      : null,

    // 현금흐름
    fcf: (operatingCF != null && investingCF != null) ? operatingCF + investingCF : null,
    fcfMargin: (operatingCF != null && investingCF != null && revenue)
      ? safePct(operatingCF + investingCF, revenue)
      : null,

    // 원본 데이터 (디버깅용)
    _raw: {
      revenue, operatingProfit, netIncome,
      totalAssets, totalLiabilities, totalEquity,
      currentAssets, currentLiabilities,
      operatingCF, investingCF,
      prevRevenue, prevOperatingProfit,
      marketCap, sharesOutstanding,
    },
  };

  logger.info(MOD, `비율 계산 완료 - PER:${fmt(ratios.per)} PBR:${fmt(ratios.pbr)} ROE:${fmt(ratios.roe)}%`);
  return ratios;
}

/** 안전한 나눗셈 (0 나누기 방지) */
function safeDiv(numerator, denominator) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

/** 안전한 퍼센트 계산 */
function safePct(numerator, denominator) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100; // 소수점 2자리 %
}

function fmt(v) {
  return v != null ? v.toFixed(2) : 'N/A';
}

module.exports = { calculateRatios, _safeDiv: safeDiv, _safePct: safePct };
