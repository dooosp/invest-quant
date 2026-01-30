const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

const MOD = 'ATClient';
const client = axios.create({
  baseURL: config.autoTrader.baseUrl,
  timeout: config.autoTrader.timeout || 5000,
});

/**
 * auto-trader 헬스체크
 */
async function healthCheck() {
  try {
    const res = await client.get('/health');
    return { ok: true, data: res.data };
  } catch (error) {
    logger.warn(MOD, `auto-trader 연결 실패: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/**
 * auto-trader 포트폴리오 조회
 * auto-trader가 /api/portfolio 엔드포인트를 제공하는 경우
 */
async function getPortfolio() {
  try {
    const res = await client.get('/api/portfolio');
    return res.data;
  } catch (error) {
    logger.warn(MOD, `포트폴리오 조회 실패: ${error.message}`);
    return null;
  }
}

/**
 * auto-trader 매매 기록 조회
 */
async function getTradeHistory() {
  try {
    const res = await client.get('/api/trades');
    return res.data;
  } catch (error) {
    logger.warn(MOD, `매매기록 조회 실패: ${error.message}`);
    return null;
  }
}

module.exports = { healthCheck, getPortfolio, getTradeHistory };
