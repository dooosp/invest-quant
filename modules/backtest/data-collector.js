const axios = require('axios');
const config = require('../../config');
const { loadCache, saveCache } = require('../../utils/file-helper');
const logger = require('../../utils/logger');
const path = require('path');

const MOD = 'DataCollect';
const axiosInstance = axios.create({ timeout: 15000 });

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) return accessToken;

  const url = `${config.kis.baseUrl}/oauth2/tokenP`;
  const res = await axiosInstance.post(url, {
    grant_type: 'client_credentials',
    appkey: config.kis.appKey,
    appsecret: config.kis.appSecret,
  });

  accessToken = res.data.access_token;
  tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
  logger.info(MOD, 'KIS 토큰 발급');
  return accessToken;
}

async function getHeaders(trId) {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    appkey: config.kis.appKey,
    appsecret: config.kis.appSecret,
    tr_id: trId,
  };
}

function formatDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 일봉 OHLCV 데이터 수집 (캐싱 포함)
 * @param {string} stockCode - 종목코드
 * @param {number} days - 조회 일수 (거래일 기준)
 * @returns {Array} [{date, open, high, low, close, volume}]
 */
async function fetchDailyCandles(stockCode, days = 365) {
  const cachePath = path.join(config.dataPath.historical, `${stockCode}_${days}d.json`);
  const cached = loadCache(cachePath, 1); // 1일 캐시
  if (cached && cached.candles) {
    logger.info(MOD, `캐시 사용: ${stockCode} (${cached.candles.length}봉)`);
    return cached.candles;
  }

  const trId = 'FHKST03010100';
  const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.ceil(days * 1.5));

  try {
    await delay(200); // rate limit 방지
    const response = await axiosInstance.get(url, {
      headers: await getHeaders(trId),
      params: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: formatDate(startDate),
        FID_INPUT_DATE_2: formatDate(endDate),
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    });

    const output = response.data.output2 || [];
    const candles = output
      .slice(0, days)
      .reverse()
      .map(item => ({
        date: item.stck_bsop_date,
        open: parseInt(item.stck_oprc),
        high: parseInt(item.stck_hgpr),
        low: parseInt(item.stck_lwpr),
        close: parseInt(item.stck_clpr),
        volume: parseInt(item.acml_vol),
      }));

    saveCache(cachePath, { candles });
    logger.info(MOD, `데이터 수집: ${stockCode} (${candles.length}봉)`);
    return candles;
  } catch (error) {
    logger.error(MOD, `데이터 수집 실패: ${stockCode}`, error);
    return [];
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { fetchDailyCandles };
