'use strict';
const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = function authMiddleware(req, res, next) {
  const apiKey = process.env.INVEST_QUANT_API_KEY;
  const env = process.env.NODE_ENV || 'development';

  // 개발 환경에서만 키 미설정 bypass
  if (!apiKey) {
    if (env === 'development') return next();
    return res.status(500).json({
      error: 'ServerMisconfigured',
      message: 'INVEST_QUANT_API_KEY 미설정',
    });
  }

  const headerKey = req.headers['x-api-key'];
  const bearer = req.headers['authorization'];
  const provided =
    (typeof headerKey === 'string' && headerKey) ||
    (typeof bearer === 'string' && bearer.startsWith('Bearer ')
      ? bearer.slice(7)
      : '');

  if (!provided || !safeEqual(provided, apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
