'use strict';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function hasForbiddenKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(k)) return true;
  }
  return false;
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

const STOCK_CODE_RE = /^\d{6}$/;

function validateBuyInput(req, res, next) {
  const body = req.body || {};
  const { stockCode, currentPrice, technicalScore, holdings } = body;
  const errors = [];

  if (!stockCode || typeof stockCode !== 'string' || !STOCK_CODE_RE.test(stockCode))
    errors.push('stockCode: 6자리 숫자 문자열 필수');

  if (!isFiniteNum(currentPrice) || currentPrice <= 0)
    errors.push('currentPrice: 양수(finite number) 필수');

  if (technicalScore != null) {
    if (!isFiniteNum(technicalScore) || technicalScore < 0 || technicalScore > 100)
      errors.push('technicalScore: 0-100 범위');
  }

  if (holdings != null) {
    if (!Array.isArray(holdings)) {
      errors.push('holdings: 배열이어야 함');
    } else {
      if (holdings.length > 50) errors.push('holdings: 최대 50종목');
      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i];
        if (!h || typeof h !== 'object') { errors.push(`holdings[${i}]: 객체 필수`); continue; }
        if (hasForbiddenKeys(h)) { errors.push(`holdings[${i}]: 금지된 키 포함`); continue; }
        if (h.code != null && (typeof h.code !== 'string' || !STOCK_CODE_RE.test(h.code)))
          errors.push(`holdings[${i}].code: 6자리 숫자`);
        if (h.quantity != null && (!Number.isInteger(h.quantity) || h.quantity < 0))
          errors.push(`holdings[${i}].quantity: 0 이상 정수`);
        if (h.weight != null && (!isFiniteNum(h.weight) || h.weight < 0 || h.weight > 1))
          errors.push(`holdings[${i}].weight: 0~1 범위`);
      }
    }
  }

  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  next();
}

function validateSellInput(req, res, next) {
  const body = req.body || {};
  const { stockCode } = body;
  const errors = [];

  if (!stockCode || typeof stockCode !== 'string' || !STOCK_CODE_RE.test(stockCode))
    errors.push('stockCode: 6자리 숫자 문자열 필수');

  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  next();
}

function validateBacktestInput(req, res, next) {
  const body = req.body || {};
  const { stockCode, days } = body;
  const errors = [];

  if (!stockCode || typeof stockCode !== 'string' || !STOCK_CODE_RE.test(stockCode))
    errors.push('stockCode: 6자리 숫자 문자열 필수');

  if (days != null) {
    if (!Number.isInteger(days) || days < 20 || days > 500)
      errors.push('days: 20-500 범위의 정수');
  }

  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  next();
}

function validatePortfolioInput(req, res, next) {
  const body = req.body || {};
  const { holdings } = body;
  const errors = [];

  if (!holdings || !Array.isArray(holdings) || holdings.length === 0)
    errors.push('holdings: 비어있지 않은 배열 필수');
  else if (holdings.length > 50)
    errors.push('holdings: 최대 50종목');
  else {
    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      if (!h || typeof h !== 'object') { errors.push(`holdings[${i}]: 객체 필수`); continue; }
      if (hasForbiddenKeys(h)) { errors.push(`holdings[${i}]: 금지된 키 포함`); continue; }
      if (!h.code || typeof h.code !== 'string' || !STOCK_CODE_RE.test(h.code))
        errors.push(`holdings[${i}].code: 6자리 숫자 필수`);
      if (h.quantity != null && (!Number.isInteger(h.quantity) || h.quantity <= 0))
        errors.push(`holdings[${i}].quantity: 양의 정수`);
    }
  }

  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  next();
}

module.exports = { validateBuyInput, validateSellInput, validateBacktestInput, validatePortfolioInput };
