'use strict';
const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

module.exports = function authMiddleware(req, res, next) {
  const apiKey = process.env.INVEST_QUANT_API_KEY;

  // 환경과 무관하게 인증은 항상 켬 (운영 사고 방지)
  if (!apiKey) {
    return res.status(500).json({
      error: 'ServerMisconfigured',
      message: 'INVEST_QUANT_API_KEY 미설정',
    });
  }

  const provided =
    req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (!provided || !timingSafeEqualStr(provided, apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
