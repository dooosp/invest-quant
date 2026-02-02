'use strict';
const config = require('../../config');

/**
 * 국면별 방어 정책
 * regime → { maxInvestRatio, buyGate, confidenceBoost, positionMultiplier }
 */

const DEFAULT_POLICIES = {
  BULL:    { maxInvestRatio: 1.0,  buyGate: 'OPEN',       confidenceBoost: 0,  positionMultiplier: 1.0 },
  NEUTRAL: { maxInvestRatio: 0.8,  buyGate: 'OPEN',       confidenceBoost: 10, positionMultiplier: 0.8 },
  BEAR:    { maxInvestRatio: 0.5,  buyGate: 'RESTRICTED', confidenceBoost: 20, positionMultiplier: 0.5 },
  CRISIS:  { maxInvestRatio: 0.2,  buyGate: 'CLOSED',     confidenceBoost: 0,  positionMultiplier: 0.2 },
};

function getPolicy(regime) {
  const overrides = (config.defense || {}).policies || {};
  return { ...DEFAULT_POLICIES[regime], ...(overrides[regime] || {}) };
}

/**
 * 매수 게이트 검사
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkBuyGate(regime, confidence) {
  const policy = getPolicy(regime);

  if (policy.buyGate === 'CLOSED') {
    return { allowed: false, reason: `시장 국면 ${regime} — 신규매수 차단` };
  }

  if (policy.buyGate === 'RESTRICTED') {
    const minConfidence = (config.defense || {}).bearMinConfidence || 70;
    if (confidence < minConfidence) {
      return { allowed: false, reason: `${regime} 국면: 신뢰도 ${confidence} < ${minConfidence} 기준 미달` };
    }
  }

  return { allowed: true };
}

module.exports = { getPolicy, checkBuyGate, DEFAULT_POLICIES };
