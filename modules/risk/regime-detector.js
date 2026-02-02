'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

const MOD = 'Regime';

/**
 * 시장 국면 감지 (3-시그널 앙상블)
 * BULL(0) / NEUTRAL(1) / BEAR(2) / CRISIS(3)
 */

function loadKospiCandles() {
  const candidates = [
    path.resolve(__dirname, '../../data/historical/kospi_daily.json'),
    path.resolve(__dirname, '../../../auto-trader/data/market/kospi_daily.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        // file-helper 캐시 형태: { candles: [...], _cachedAt } 또는 배열 직접
        return Array.isArray(raw) ? raw : (raw.candles || raw);
      } catch { /* skip */ }
    }
  }
  return null;
}

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function realizedVol(closes, period = 20) {
  if (closes.length < period + 1) return null;
  const rets = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 10) return null;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100; // 연환산 %
}

function momentum(closes, lookback = 60) {
  if (closes.length < lookback + 1) return null;
  const prev = closes[closes.length - 1 - lookback];
  const curr = closes[closes.length - 1];
  return prev > 0 ? ((curr - prev) / prev) * 100 : null;
}

let cachedRegime = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분

// confirmDays: 국면 전환 확인 상태
let confirmedRegime = null;   // 확정된 국면
let pendingRegime = null;     // 전환 대기 국면
let pendingDate = null;       // 전환 대기 시작 날짜 (YYYY-MM-DD)
let pendingCount = 0;         // 연속 확인 일수

function detectRegime() {
  const now = Date.now();
  if (cachedRegime && (now - cacheTime) < CACHE_TTL) return cachedRegime;

  const def = config.defense || {};
  const candles = loadKospiCandles();

  if (!candles || candles.length < 61) {
    logger.warn(MOD, 'KOSPI 데이터 부족 → NEUTRAL 폴백');
    cachedRegime = { regime: 'NEUTRAL', signals: {}, fallback: true };
    cacheTime = now;
    return cachedRegime;
  }

  const closes = candles.map(c => c.close || c.stck_clpr || c.price).filter(Boolean);
  if (closes.length < 61) {
    cachedRegime = { regime: 'NEUTRAL', signals: {}, fallback: true };
    cacheTime = now;
    return cachedRegime;
  }

  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const vol = realizedVol(closes, 20);
  const mom = momentum(closes, 60);

  const volThreshold = (def.volThreshold || 25);
  const momThreshold = (def.momThreshold || -10);

  let bearCount = 0;
  const signals = {};

  // 1. MA 데드크로스
  signals.maCross = ma20 !== null && ma60 !== null ? ma20 < ma60 : false;
  if (signals.maCross) bearCount++;

  // 2. 고변동성
  signals.highVol = vol !== null ? vol > volThreshold : false;
  if (signals.highVol) bearCount++;

  // 3. 음의 모멘텀
  signals.negMom = mom !== null ? mom < momThreshold : false;
  if (signals.negMom) bearCount++;

  signals.ma20 = ma20 ? Math.round(ma20 * 100) / 100 : null;
  signals.ma60 = ma60 ? Math.round(ma60 * 100) / 100 : null;
  signals.vol20d = vol ? Math.round(vol * 100) / 100 : null;
  signals.mom60d = mom ? Math.round(mom * 100) / 100 : null;

  const REGIMES = ['BULL', 'NEUTRAL', 'BEAR', 'CRISIS'];
  const rawRegime = REGIMES[bearCount];
  const confirmDays = (def.confirmDays || 2);
  const today = new Date().toISOString().slice(0, 10);

  // 첫 실행: 확정 국면 초기화
  if (!confirmedRegime) confirmedRegime = rawRegime;

  // confirmDays 적용하여 최종 국면 결정
  let regime;
  if (rawRegime === confirmedRegime) {
    // 국면 유지 — pending 초기화
    pendingRegime = null;
    pendingDate = null;
    pendingCount = 0;
    regime = confirmedRegime;
  } else if (rawRegime === 'CRISIS') {
    // CRISIS는 즉시 전환 (지연 불가)
    confirmedRegime = rawRegime;
    pendingRegime = null;
    pendingDate = null;
    pendingCount = 0;
    regime = rawRegime;
    logger.warn(MOD, `CRISIS 즉시 전환 — confirmDays 생략`);
  } else if (pendingRegime === rawRegime) {
    // 같은 pending 국면이 다른 날에도 감지됨
    if (today !== pendingDate) {
      pendingCount++;
      pendingDate = today;
    }
    if (pendingCount >= confirmDays) {
      confirmedRegime = rawRegime;
      pendingRegime = null;
      pendingDate = null;
      pendingCount = 0;
      regime = rawRegime;
      logger.info(MOD, `국면 전환 확정: ${rawRegime} (${confirmDays}일 확인 완료)`);
    } else {
      regime = confirmedRegime;
      logger.info(MOD, `국면 전환 대기: ${rawRegime} (${pendingCount}/${confirmDays}일)`);
    }
  } else {
    // 새로운 pending 시작
    pendingRegime = rawRegime;
    pendingDate = today;
    pendingCount = 1;
    regime = confirmedRegime;
    logger.info(MOD, `국면 전환 감지: ${confirmedRegime}→${rawRegime} (확인 1/${confirmDays}일)`);
  }

  logger.info(MOD, `국면: ${regime} (raw:${rawRegime} BEAR신호 ${bearCount}/3 — MA:${signals.maCross} Vol:${signals.highVol} Mom:${signals.negMom})`);

  const pending = pendingRegime ? { regime: pendingRegime, count: pendingCount, required: confirmDays } : null;
  cachedRegime = { regime, bearCount, signals, pending, timestamp: new Date().toISOString() };
  cacheTime = now;
  return cachedRegime;
}

function clearCache() {
  cachedRegime = null;
  cacheTime = 0;
  // pending 상태는 유지 (clearCache는 데이터 갱신 시 호출 — 전환 카운트 리셋하면 안 됨)
}

function resetAll() {
  cachedRegime = null;
  cacheTime = 0;
  confirmedRegime = null;
  pendingRegime = null;
  pendingDate = null;
  pendingCount = 0;
}

module.exports = { detectRegime, clearCache, resetAll };
