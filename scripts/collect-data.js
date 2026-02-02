#!/usr/bin/env node
/**
 * 데이터 수집 스크립트: KIS 일봉 + DART 재무 → 파이프라인용 캐시
 * Usage: node scripts/collect-data.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { fetchDailyCandles } = require('../modules/backtest/data-collector');
const { scoreFundamental } = require('../modules/fundamental/fundamental-scorer');
const logger = require('../utils/logger');

const MOD = 'Collect';

// 수집 대상 종목 (auto-trader 워치리스트 + 주요 대형주)
const TARGETS = [
  // === 기존 20 (대형주) ===
  { code: '005930', name: '삼성전자', cap: 400e12, shares: 5969782550 },
  { code: '000660', name: 'SK하이닉스', cap: 150e12, shares: 728002365 },
  { code: '005380', name: '현대차', cap: 50e12, shares: 211531506 },
  { code: '000270', name: '기아', cap: 40e12, shares: 421257692 },
  { code: '035420', name: 'NAVER', cap: 45e12, shares: 163532703 },
  { code: '035720', name: '카카오', cap: 15e12, shares: 433279400 },
  { code: '068270', name: '셀트리온', cap: 30e12, shares: 136982018 },
  { code: '006400', name: '삼성SDI', cap: 25e12, shares: 68764530 },
  { code: '003550', name: 'LG', cap: 10e12, shares: 163647814 },
  { code: '055550', name: '신한지주', cap: 22e12, shares: 501599808 },
  { code: '105560', name: 'KB금융', cap: 28e12, shares: 403009522 },
  { code: '086790', name: '하나금융지주', cap: 18e12, shares: 283028637 },
  { code: '066570', name: 'LG전자', cap: 15e12, shares: 163647814 },
  { code: '051910', name: 'LG화학', cap: 20e12, shares: 70592343 },
  { code: '032830', name: '삼성생명', cap: 16e12, shares: 200000000 },
  { code: '015760', name: '한국전력', cap: 15e12, shares: 641964077 },
  { code: '034730', name: 'SK', cap: 12e12, shares: 37539162 },
  { code: '012330', name: '현대모비스', cap: 18e12, shares: 97343863 },
  { code: '207940', name: '삼성바이오', cap: 50e12, shares: 71174000 },
  { code: '009150', name: '삼성전기', cap: 10e12, shares: 74693696 },
  // === 확장 30 (코스피200 중형주) ===
  { code: '005490', name: 'POSCO홀딩스', cap: 20e12, shares: 84571230 },
  { code: '028260', name: '삼성물산', cap: 25e12, shares: 186897560 },
  { code: '017670', name: 'SK텔레콤', cap: 13e12, shares: 72060550 },
  { code: '030200', name: 'KT', cap: 10e12, shares: 261111808 },
  { code: '036570', name: 'NCsoft', cap: 6e12, shares: 21954022 },
  { code: '018260', name: '삼성에스디에스', cap: 15e12, shares: 77377800 },
  { code: '010130', name: '고려아연', cap: 10e12, shares: 18840000 },
  { code: '011170', name: '롯데케미칼', cap: 4e12, shares: 34275419 },
  { code: '047050', name: '포스코인터', cap: 4e12, shares: 87187872 },
  { code: '004020', name: '현대제철', cap: 5e12, shares: 137850000 },
  { code: '003490', name: '대한항공', cap: 10e12, shares: 276177634 },
  { code: '096770', name: 'SK이노베이션', cap: 10e12, shares: 94962590 },
  { code: '010950', name: 'S-Oil', cap: 5e12, shares: 112582792 },
  { code: '000810', name: '삼성화재', cap: 15e12, shares: 47174000 },
  { code: '316140', name: '우리금융', cap: 12e12, shares: 696817232 },
  { code: '138040', name: '메리츠금융', cap: 15e12, shares: 182291630 },
  { code: '011200', name: 'HMM', cap: 8e12, shares: 771350186 },
  { code: '024110', name: '기업은행', cap: 8e12, shares: 762568816 },
  { code: '009540', name: '한국조선해양', cap: 8e12, shares: 72225424 },
  { code: '042660', name: '한화오션', cap: 8e12, shares: 335199237 },
  { code: '010140', name: '삼성중공업', cap: 6e12, shares: 1220614398 },
  { code: '329180', name: 'HD현대중공업', cap: 12e12, shares: 60000000 },
  { code: '267250', name: 'HD현대', cap: 8e12, shares: 59660000 },
  { code: '042700', name: '한미반도체', cap: 8e12, shares: 100000000 },
  { code: '247540', name: '에코프로비엠', cap: 6e12, shares: 23712460 },
  { code: '373220', name: 'LG에너지솔루션', cap: 80e12, shares: 234000000 },
  { code: '352820', name: '하이브', cap: 7e12, shares: 42210508 },
  { code: '000100', name: '유한양행', cap: 6e12, shares: 65207500 },
  { code: '006800', name: '미래에셋증권', cap: 5e12, shares: 402764310 },
  { code: '078930', name: 'GS', cap: 5e12, shares: 48575979 },
];

const HIST_DIR = path.resolve(__dirname, '..', 'data', 'historical');
const FUND_DIR = path.resolve(__dirname, '..', 'data', 'fundamentals');

async function collectPrice(stock) {
  try {
    const candles = await fetchDailyCandles(stock.code, 365);
    if (candles.length === 0) return false;

    // data_agent가 읽을 수 있는 형태로 저장 ({code}.json)
    const outPath = path.join(HIST_DIR, `${stock.code}.json`);
    fs.writeFileSync(outPath, JSON.stringify(candles, null, 2));
    logger.info(MOD, `가격: ${stock.name}(${stock.code}) ${candles.length}봉`);
    return true;
  } catch (e) {
    logger.error(MOD, `가격 실패: ${stock.name} — ${e.message}`);
    return false;
  }
}

async function collectFundamental(stock) {
  try {
    const result = await scoreFundamental(stock.code, stock.cap, stock.shares);
    if (!result.available) {
      logger.warn(MOD, `재무 없음: ${stock.name}`);
      return false;
    }

    const outPath = path.join(FUND_DIR, `${stock.code}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      code: stock.code,
      name: stock.name,
      score: result.score,
      ratios: {
        per: result.ratios?.per || 0,
        pbr: result.ratios?.pbr || 0,
        roe: result.ratios?.roe || 0,
        debtRatio: result.ratios?.debtRatio || 0,
        operatingMargin: result.ratios?.operatingMargin || 0,
        reportDate: new Date().toISOString().slice(0, 10),
      },
      breakdown: result.breakdown,
    }, null, 2));
    logger.info(MOD, `재무: ${stock.name}(${stock.code}) 점수=${result.score}`);
    return true;
  } catch (e) {
    logger.error(MOD, `재무 실패: ${stock.name} — ${e.message}`);
    return false;
  }
}

async function main() {
  fs.mkdirSync(HIST_DIR, { recursive: true });
  fs.mkdirSync(FUND_DIR, { recursive: true });

  logger.info(MOD, `=== 데이터 수집 시작 (${TARGETS.length}종목) ===`);

  let priceOk = 0, fundOk = 0;

  for (const stock of TARGETS) {
    const p = await collectPrice(stock);
    if (p) priceOk++;

    const f = await collectFundamental(stock);
    if (f) fundOk++;

    // API rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  logger.info(MOD, `=== 수집 완료: 가격 ${priceOk}/${TARGETS.length}, 재무 ${fundOk}/${TARGETS.length} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
