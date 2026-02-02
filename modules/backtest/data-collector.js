const axios = require('axios');
const config = require('../../config');
const { loadCache, saveCache } = require('../../utils/file-helper');
const logger = require('../../utils/logger');
const { CircuitBreaker } = require('../../utils/circuit-breaker');
const path = require('path');

const MOD = 'DataCollect';
const axiosInstance = axios.create({ timeout: 15000 });
const kisCB = new CircuitBreaker('KIS', { threshold: 3, resetTimeout: 30000 });

let accessToken = null;
let tokenExpiry = null;
let tokenPromise = null;


async function getAccessToken() {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) return accessToken;
  // 동시 요청 시 중복 발급 방지 (Promise singleton lock)
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const url = `${config.kis.baseUrl}/oauth2/tokenP`;
      const res = await axiosInstance.post(url, {
        grant_type: 'client_credentials',
        appkey: config.kis.appKey,
        appsecret: config.kis.appSecret,
      });

      accessToken = res.data.access_token;
      // expires_in 우선, 없으면 23시간 기본값 (여유 60초)
      const expiresIn = Number(res.data.expires_in);
      if (Number.isFinite(expiresIn) && expiresIn > 120) {
        tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);
      } else {
        tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
      }
      logger.info(MOD, 'KIS 토큰 발급');
      return accessToken;
    } finally {
      tokenPromise = null;
    }
  })();
  return tokenPromise;
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
    const response = await kisCB.call(async () =>
      axiosInstance.get(url, {
        headers: await getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stockCode,
          FID_INPUT_DATE_1: formatDate(startDate),
          FID_INPUT_DATE_2: formatDate(endDate),
          FID_PERIOD_DIV_CODE: 'D',
          FID_ORG_ADJ_PRC: '0',
        },
      })
    );

    const output = response.data.output2 || [];
    const candles = output
      .slice(0, days)
      .reverse()
      .map(item => {
        const close = safeIntOrNull(item.stck_clpr);
        if (close == null || close <= 0) return null;
        return {
          date: item.stck_bsop_date,
          open: safeIntOrNull(item.stck_oprc) ?? close,
          high: safeIntOrNull(item.stck_hgpr) ?? close,
          low: safeIntOrNull(item.stck_lwpr) ?? close,
          close,
          volume: safeIntOrNull(item.acml_vol) ?? 0,
        };
      })
      .filter(Boolean);

    saveCache(cachePath, { candles });
    logger.info(MOD, `데이터 수집: ${stockCode} (${candles.length}봉)`);
    return candles;
  } catch (error) {
    logger.error(MOD, `데이터 수집 실패: ${stockCode}`, error);
    return [];
  }
}

/**
 * 지수(KOSPI/KOSDAQ) 일봉 수집 — 네이버 금융 공개 API
 * @param {string} symbol - 'KOSPI' 또는 'KOSDAQ'
 * @param {number} days - 조회 일수
 * @returns {Array} [{date, open, high, low, close, volume}]
 */
async function fetchIndexCandles(symbol = 'KOSPI', days = 120) {
  const name = symbol.toLowerCase();
  const cachePath = path.join(config.dataPath.historical, `${name}_daily.json`);
  const cached = loadCache(cachePath, 1);
  if (cached && cached.candles && cached.candles.length > 0) {
    logger.info(MOD, `지수 캐시 사용: ${name} (${cached.candles.length}봉)`);
    return cached.candles;
  }

  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`;

  try {
    const response = await axiosInstance.get(url, { responseType: 'text' });
    const xml = response.data;

    // XML 파싱: <item data="YYYYMMDD|open|high|low|close|volume" />
    const items = [];
    const regex = /<item\s+data="([^"]+)"\s*\/>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const parts = match[1].split('|');
      if (parts.length < 6) continue;
      const close = parseFloat(parts[4]);
      if (!Number.isFinite(close) || close <= 0) continue;
      items.push({
        date: parts[0],
        open: parseFloat(parts[1]) || close,
        high: parseFloat(parts[2]) || close,
        low: parseFloat(parts[3]) || close,
        close,
        volume: parseInt(parts[5]) || 0,
      });
    }

    saveCache(cachePath, { candles: items });
    logger.info(MOD, `지수 수집: ${name} (${items.length}봉) [네이버금융]`);
    return items;
  } catch (error) {
    logger.error(MOD, `지수 수집 실패: ${name}`, error);
    return [];
  }
}

function safeIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { fetchDailyCandles, fetchIndexCandles };
