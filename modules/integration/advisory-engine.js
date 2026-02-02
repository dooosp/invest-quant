const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { scoreFundamental } = require('../fundamental/fundamental-scorer');
const { fetchDailyCandles } = require('../backtest/data-collector');
const { calculateVaR } = require('../risk/var-calculator');
const { analyzeConcentration } = require('../risk/concentration');
const { calculatePositionSize } = require('../risk/position-sizer');
const { detectRegime } = require('../risk/regime-detector');
const { getPolicy, checkBuyGate } = require('../risk/defense-policy');
const logger = require('../../utils/logger');

const MOD = 'Advisory';

// 최신 파이프라인 시그널 캐시 (5분 TTL)
let signalCache = { data: null, loadedAt: 0 };
const SIGNAL_TTL_MS = 5 * 60 * 1000;

function loadLatestSignals() {
  if (signalCache.data && Date.now() - signalCache.loadedAt < SIGNAL_TTL_MS) {
    return signalCache.data;
  }
  const runsDir = path.resolve(__dirname, '../../runs');
  if (!fs.existsSync(runsDir)) return null;
  const dirs = fs.readdirSync(runsDir).sort().reverse();
  for (const dir of dirs) {
    const sigPath = path.join(runsDir, dir, '..', '..', 'data/processed', dir.replace(/^\d{4}-\d{2}-\d{2}_/, ''), 'signals.csv');
    const sigPath2 = path.resolve(__dirname, '../../data/processed');
    // 가장 최근 signals.csv 찾기
    if (fs.existsSync(sigPath2)) {
      const subDirs = fs.readdirSync(sigPath2);
      for (const sub of subDirs) {
        const csv = path.join(sigPath2, sub, 'signals.csv');
        if (fs.existsSync(csv)) {
          const lines = fs.readFileSync(csv, 'utf-8').trim().split('\n');
          const header = lines[0].split(',');
          const map = {};
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const code = cols[0];
            const obj = {};
            header.forEach((h, idx) => { obj[h] = cols[idx]; });
            obj.composite_score = parseFloat(obj.composite_score) || 0;
            obj.rank = parseInt(obj.rank) || 999;
            map[code] = obj;
          }
          signalCache = { data: { map, total: lines.length - 1 }, loadedAt: Date.now() };
          logger.info(MOD, `팩터 시그널 로드: ${lines.length - 1}종목`);
          return signalCache.data;
        }
      }
    }
  }
  return null;
}

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

  // --- 0. 시장 국면 게이트 ---
  const regimeInfo = detectRegime();
  const regime = regimeInfo.regime;
  const policy = getPolicy(regime);
  reasons.push(`시장국면: ${regime}`);

  if (policy.buyGate === 'CLOSED') {
    logger.info(MOD, `매수 차단: ${stockCode} — ${regime} 국면`);
    return {
      approved: false, confidence: 0, fundamentalScore: null,
      regime, positionSize: null,
      reason: `시장 국면 ${regime} — 신규매수 차단`,
      reasons,
    };
  }

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

  // DART 실패 시 안전 거부 (펀더멘털 미검증 상태로 매수 불가)
  if (fundamentalScore == null) {
    logger.info(MOD, `매수 거부: ${stockCode} 펀더멘털 조회 불가 — 안전 거부`);
    return {
      approved: false, confidence: 0,
      fundamentalScore: null, positionSize: null,
      reasonCode: 'FUNDAMENTAL_UNAVAILABLE',
      reason: '펀더멘털 조회 불가 — 안전 거부(수동 확인 필요)',
      reasons,
    };
  }

  if (fundamentalScore < minScore) {
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

  // --- 2b. 팩터 랭크 게이트 ---
  let factorRank = null;
  let factorScore = null;
  const signals = loadLatestSignals();
  if (signals) {
    const sig = signals.map[stockCode];
    if (sig) {
      factorRank = sig.rank;
      factorScore = sig.composite_score;
      const topHalf = Math.ceil(signals.total / 2);
      if (factorRank > topHalf) {
        // 하위 50% — 신뢰도 감점 (거부는 아님)
        riskScore = Math.max(riskScore - 20, 0);
        reasons.push(`팩터 랭크 ${factorRank}/${signals.total} (하위권 감점 -20)`);
      } else {
        reasons.push(`팩터 랭크 ${factorRank}/${signals.total} (상위권)`);
      }
    }
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

  // --- 5. 국면별 매수 게이트 (RESTRICTED 체크) ---
  const gateResult = checkBuyGate(regime, confidence);
  if (!gateResult.allowed) {
    logger.info(MOD, `매수 거부: ${stockCode} — ${gateResult.reason}`);
    return {
      approved: false, confidence, fundamentalScore, factorRank, factorScore,
      regime, positionSize: null, reason: gateResult.reason, reasons,
    };
  }

  // 국면별 포지션 축소
  if (positionSize != null) {
    positionSize = Math.round(positionSize * policy.positionMultiplier);
    if (policy.positionMultiplier < 1) reasons.push(`국면 포지션 축소 ×${policy.positionMultiplier}`);
  }

  logger.info(MOD, `매수 승인: ${stockCode} 신뢰도 ${confidence} 국면:${regime} (F:${fNorm} T:${tNorm} R:${riskScore}) 포지션:${positionSize || 'N/A'}`);

  return {
    approved: true,
    confidence,
    fundamentalScore,
    factorRank,
    factorScore,
    regime,
    positionSize,
    reason: `종합 신뢰도 ${confidence}점 (펀더멘털 ${fNorm} × ${WEIGHTS.fundamental} + 기술 ${tNorm} × ${WEIGHTS.technical} + 리스크 ${riskScore} × ${WEIGHTS.risk}) [${regime}]`,
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

module.exports = { adviseBuy, adviseSell, loadLatestSignals };
