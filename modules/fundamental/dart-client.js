const axios = require('axios');
const config = require('../../config');
const { loadCache, saveCache } = require('../../utils/file-helper');
const logger = require('../../utils/logger');
const path = require('path');

const MOD = 'DART';
const axiosInstance = axios.create({ timeout: 15000 });

// 종목코드 → DART 고유번호 캐시 (메모리)
let corpCodeMap = null;

/**
 * 재시도 래퍼 (b2b-lead-agent withRetry 패턴)
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;

      if (!retryable || attempt === maxRetries) throw error;

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      logger.warn(MOD, `재시도 ${attempt}/${maxRetries} (status=${status}, wait=${delay}ms)`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * 종목코드 → DART 고유번호 변환
 * DART API는 corp_code(고유번호)를 사용하므로 변환 필요
 */
async function getCorpCode(stockCode) {
  if (!corpCodeMap) {
    const cachePath = path.join(config.dataPath.fundamentals, '_corp_codes.json');
    const cached = loadCache(cachePath, 30); // 30일 캐시

    if (cached && cached.map) {
      corpCodeMap = cached.map;
    } else {
      // DART corpCode.xml은 ZIP으로 제공 → 대안: company API로 개별 조회
      corpCodeMap = {};
    }
  }

  if (corpCodeMap[stockCode]) {
    return corpCodeMap[stockCode];
  }

  // company API로 개별 조회
  try {
    const response = await withRetry(() =>
      axiosInstance.get(`${config.dart.baseUrl}/company.json`, {
        params: {
          crtfc_key: config.dart.apiKey,
          stock_code: stockCode,
        },
      })
    );

    if (response.data.status === '000') {
      const corpCode = response.data.corp_code;
      corpCodeMap[stockCode] = corpCode;

      // 캐시 저장
      const cachePath = path.join(config.dataPath.fundamentals, '_corp_codes.json');
      saveCache(cachePath, { map: corpCodeMap });

      return corpCode;
    }
    logger.warn(MOD, `기업 정보 없음: ${stockCode} (${response.data.message})`);
    return null;
  } catch (error) {
    logger.error(MOD, `기업 정보 조회 실패: ${stockCode}`, error);
    return null;
  }
}

/**
 * 재무제표 전체 조회 (fnlttSinglAcntAll)
 * @param {string} stockCode - 6자리 종목코드
 * @param {string} bsnsYear - 사업연도 (예: '2024')
 * @param {string} reprtCode - 보고서 코드 (11011=사업보고서, 11014=반기, 11012=1분기, 11013=3분기)
 */
async function getFinancialStatements(stockCode, bsnsYear, reprtCode = '11011') {
  // 캐시 확인
  const cacheKey = `${stockCode}_${bsnsYear}_${reprtCode}`;
  const cachePath = path.join(config.dataPath.fundamentals, `${cacheKey}.json`);
  const cached = loadCache(cachePath, config.dart.cacheDays);
  if (cached && cached.statements) {
    logger.info(MOD, `캐시 사용: ${stockCode} ${bsnsYear}`);
    return cached.statements;
  }

  const corpCode = await getCorpCode(stockCode);
  if (!corpCode) return null;

  try {
    const response = await withRetry(() =>
      axiosInstance.get(`${config.dart.baseUrl}/fnlttSinglAcntAll.json`, {
        params: {
          crtfc_key: config.dart.apiKey,
          corp_code: corpCode,
          bsns_year: bsnsYear,
          reprt_code: reprtCode,
          fs_div: 'CFS', // 연결재무제표
        },
      })
    );

    if (response.data.status === '000') {
      const statements = response.data.list;
      saveCache(cachePath, { statements });
      logger.info(MOD, `재무제표 조회: ${stockCode} ${bsnsYear} (${statements.length}건)`);
      return statements;
    }

    // 연결재무제표 없으면 개별재무제표 시도
    if (response.data.status === '013') {
      logger.warn(MOD, `연결재무제표 없음, 개별 시도: ${stockCode}`);
      const response2 = await withRetry(() =>
        axiosInstance.get(`${config.dart.baseUrl}/fnlttSinglAcntAll.json`, {
          params: {
            crtfc_key: config.dart.apiKey,
            corp_code: corpCode,
            bsns_year: bsnsYear,
            reprt_code: reprtCode,
            fs_div: 'OFS', // 개별재무제표
          },
        })
      );

      if (response2.data.status === '000') {
        const statements = response2.data.list;
        saveCache(cachePath, { statements });
        return statements;
      }
    }

    logger.warn(MOD, `재무제표 없음: ${stockCode} ${bsnsYear} (${response.data.message})`);
    return null;
  } catch (error) {
    logger.error(MOD, `재무제표 조회 실패: ${stockCode}`, error);
    return null;
  }
}

/**
 * 최근 2개년 재무제표 조회 (성장률 계산용)
 */
async function getRecentFinancials(stockCode) {
  const now = new Date();
  const currentYear = now.getFullYear();
  // 4월 이전이면 아직 전년도 사업보고서 미공시 가능
  const latestYear = now.getMonth() < 3 ? currentYear - 2 : currentYear - 1;

  const [current, previous] = await Promise.all([
    getFinancialStatements(stockCode, String(latestYear)),
    getFinancialStatements(stockCode, String(latestYear - 1)),
  ]);

  return { current, previous, year: latestYear };
}

/**
 * 재무제표에서 특정 계정과목 금액 추출
 * @param {Array} statements - DART 재무제표 리스트
 * @param {string} accountName - 계정과목명 (예: '매출액')
 * @param {string} sjDiv - 재무제표 구분 (IS=손익, BS=재무상태표, CF=현금흐름)
 */
function extractAmount(statements, accountName, sjDiv = null) {
  if (!statements) return null;

  const item = statements.find(s => {
    const nameMatch = s.account_nm && s.account_nm.includes(accountName);
    const divMatch = !sjDiv || s.sj_div === sjDiv;
    return nameMatch && divMatch;
  });

  if (!item) return null;

  // thstrm_amount: 당기금액 (문자열, 콤마 포함 가능)
  const raw = item.thstrm_amount;
  if (!raw || raw === '-') return null;

  return parseInt(raw.replace(/,/g, ''), 10);
}

module.exports = {
  getFinancialStatements,
  getRecentFinancials,
  getCorpCode,
  extractAmount,
};
