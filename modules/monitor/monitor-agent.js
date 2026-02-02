/**
 * Monitoring Agent — 드로우다운/노출도/결손 감지 + 중단 규칙
 *
 * 규칙:
 *   일일 손실 > 3% → PAUSE_BUY
 *   누적 MDD > 8% → REDUCE
 *   누적 MDD > 12% → LIQUIDATE
 *   IS/OOS 괴리 > 50% → STRATEGY_DEGRADED
 *   데이터 결손 → FAIL_CLOSED
 */
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { detectRegime } = require('../risk/regime-detector');

const MOD = 'Monitor';

const THRESHOLDS = {
  dailyLossLimit: 0.03,
  mddReduce: 0.08,
  mddLiquidate: 0.12,
  oosGapWarning: 0.5,
};

function checkDrawdown(dailyReturnsPath) {
  if (!fs.existsSync(dailyReturnsPath)) {
    return { action: 'FAIL_CLOSED', reason: 'daily-returns.json 없음' };
  }

  const data = JSON.parse(fs.readFileSync(dailyReturnsPath, 'utf-8'));
  if (!Array.isArray(data) || data.length < 2) {
    return { action: 'NORMAL', dailyLoss: 0, mdd: 0 };
  }

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];

  // 일일 손실
  const dailyLoss = prev.totalEvaluation > 0
    ? (latest.totalEvaluation - prev.totalEvaluation) / prev.totalEvaluation
    : 0;

  // 누적 MDD
  let peak = 0;
  let mdd = 0;
  for (const d of data) {
    const val = d.totalEvaluation || 0;
    if (val > peak) peak = val;
    const dd = peak > 0 ? (val - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }

  let action = 'NORMAL';
  let reason = '';

  if (Math.abs(dailyLoss) >= THRESHOLDS.dailyLossLimit && dailyLoss < 0) {
    action = 'PAUSE_BUY';
    reason = `일일 손실 ${(dailyLoss * 100).toFixed(2)}% >= ${THRESHOLDS.dailyLossLimit * 100}%`;
  }
  if (Math.abs(mdd) >= THRESHOLDS.mddLiquidate) {
    action = 'LIQUIDATE';
    reason = `MDD ${(mdd * 100).toFixed(2)}% >= ${THRESHOLDS.mddLiquidate * 100}%`;
  } else if (Math.abs(mdd) >= THRESHOLDS.mddReduce) {
    action = action === 'PAUSE_BUY' ? 'REDUCE' : 'REDUCE';
    reason = `MDD ${(mdd * 100).toFixed(2)}% >= ${THRESHOLDS.mddReduce * 100}%`;
  }

  return { action, dailyLoss: Math.round(dailyLoss * 10000) / 10000, mdd: Math.round(mdd * 10000) / 10000, reason };
}

function checkStrategyHealth(runDir) {
  const resultPath = path.join(runDir, 'run_result.json');
  if (!fs.existsSync(resultPath)) return { healthy: true };

  let result;
  try {
    const raw = fs.readFileSync(resultPath, 'utf-8').replace(/:\s*(Infinity|-Infinity|NaN)/g, ': null');
    result = JSON.parse(raw);
  } catch (e) {
    logger.warn(MOD, `run_result.json 파싱 실패: ${e.message}`);
    return { healthy: true };
  }
  const wf = result.walk_forward || {};
  const alerts = [];

  if (wf.warning) {
    alerts.push(wf.warning);
  }

  const is_sharpe = wf.in_sample?.sharpe || 0;
  const oos_sharpe = wf.out_of_sample?.sharpe || 0;
  if (is_sharpe > 0 && oos_sharpe / is_sharpe < THRESHOLDS.oosGapWarning) {
    alerts.push('STRATEGY_DEGRADED: IS/OOS 괴리 심함');
  }

  return { healthy: alerts.length === 0, alerts };
}

function getStatus(autoTraderDataDir, latestRunDir = null) {
  const dailyPath = path.join(autoTraderDataDir, 'daily-returns.json');
  const dd = checkDrawdown(dailyPath);
  const health = latestRunDir ? checkStrategyHealth(latestRunDir) : { healthy: true };

  const regimeInfo = detectRegime();

  // CRISIS 국면 시 기존 MDD 액션과 무관하게 REDUCE 강제
  let recommendation = dd.action;
  if (regimeInfo.regime === 'CRISIS' && recommendation === 'NORMAL') {
    recommendation = 'REDUCE';
  }

  const status = {
    timestamp: new Date().toISOString(),
    drawdown: dd,
    strategy: health,
    regime: regimeInfo,
    recommendation,
  };

  if (dd.action !== 'NORMAL') {
    logger.warn(MOD, `[${dd.action}] ${dd.reason}`);
  }
  if (regimeInfo.regime === 'CRISIS' || regimeInfo.regime === 'BEAR') {
    logger.warn(MOD, `[${regimeInfo.regime}] 시장 국면 경고`);
  }
  if (!health.healthy) {
    logger.warn(MOD, `전략 경고: ${health.alerts.join(', ')}`);
  }

  return status;
}

module.exports = { getStatus, checkDrawdown, checkStrategyHealth, THRESHOLDS };
