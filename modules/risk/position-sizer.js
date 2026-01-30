const { ATR } = require('../backtest/strategy-engine');
const logger = require('../../utils/logger');

const MOD = 'PosSize';

/**
 * 포지션 사이즈 계산 (Half-Kelly + ATR 기반)
 *
 * 두 방법의 최솟값을 채택하여 보수적 운영:
 * 1. Half-Kelly: f* = (bp - q) / b × 0.5
 * 2. ATR 기반: 계좌의 2%를 1 ATR에 할당
 *
 * @param {object} params
 * @param {number} params.accountBalance - 계좌 잔고
 * @param {number} params.defaultBuyAmount - 기본 매수금액 (config.trading.buyAmount)
 * @param {number} params.winRate - 승률 (0~1)
 * @param {number} params.avgWinLossRatio - 평균 수익/손실 비율
 * @param {Array} params.candles - 최근 캔들 데이터 (ATR 계산용)
 * @param {number} params.currentPrice - 현재가
 * @returns {object} { positionSize, method, kelly, atrBased, reasons }
 */
function calculatePositionSize(params) {
  const {
    accountBalance,
    defaultBuyAmount = 500000,
    winRate,
    avgWinLossRatio,
    candles,
    currentPrice,
  } = params;

  const minSize = Math.round(defaultBuyAmount * 0.5);  // 하한: 기본의 50%
  const maxSize = Math.round(defaultBuyAmount * 2.0);   // 상한: 기본의 200%
  const reasons = [];

  // --- Half-Kelly Criterion ---
  let kellySize = null;
  if (winRate != null && avgWinLossRatio != null && avgWinLossRatio > 0) {
    const b = avgWinLossRatio; // 평균 수익/손실 비율
    const p = winRate;
    const q = 1 - p;
    const fullKelly = (b * p - q) / b;
    const halfKelly = fullKelly * 0.5; // Half-Kelly

    if (halfKelly > 0) {
      kellySize = Math.round(accountBalance * halfKelly);
      reasons.push(`Half-Kelly: ${(halfKelly * 100).toFixed(1)}% = ${kellySize.toLocaleString()}원`);
    } else {
      reasons.push(`Kelly 음수 (${(fullKelly * 100).toFixed(1)}%) → 매수 비권고`);
    }
  }

  // --- ATR 기반 포지션 사이징 ---
  let atrSize = null;
  if (candles && candles.length > 15 && currentPrice > 0) {
    const atrResult = ATR(candles, 14);
    if (atrResult.atr != null && atrResult.atr > 0) {
      // 계좌의 2%를 1 ATR 리스크에 할당
      const riskAmount = accountBalance * 0.02;
      const sharesFromATR = Math.floor(riskAmount / atrResult.atr);
      atrSize = sharesFromATR * currentPrice;
      reasons.push(`ATR ${Math.round(atrResult.atr)}원 → ${sharesFromATR}주 = ${atrSize.toLocaleString()}원`);
    }
  }

  // --- 최종 결정: 두 방법 중 보수적(작은) 값 채택 ---
  const candidates = [kellySize, atrSize].filter(v => v != null && v > 0);

  let positionSize;
  let method;

  if (candidates.length === 0) {
    positionSize = defaultBuyAmount;
    method = 'DEFAULT';
    reasons.push('계산 불가 → 기본 매수금액 사용');
  } else {
    positionSize = Math.min(...candidates);
    method = positionSize === kellySize ? 'HALF_KELLY' : 'ATR_BASED';
  }

  // cap 적용
  if (positionSize < minSize) {
    positionSize = minSize;
    reasons.push(`하한 적용: ${minSize.toLocaleString()}원`);
  }
  if (positionSize > maxSize) {
    positionSize = maxSize;
    reasons.push(`상한 적용: ${maxSize.toLocaleString()}원`);
  }

  positionSize = Math.round(positionSize);

  logger.info(MOD, `포지션: ${positionSize.toLocaleString()}원 (${method}) | Kelly:${kellySize} ATR:${atrSize}`);

  return {
    positionSize,
    method,
    kelly: kellySize ? { size: kellySize, fraction: kellySize / accountBalance } : null,
    atrBased: atrSize ? { size: atrSize } : null,
    limits: { min: minSize, max: maxSize },
    reasons,
  };
}

module.exports = { calculatePositionSize };
