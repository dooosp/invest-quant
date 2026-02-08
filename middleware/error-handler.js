'use strict';
const logger = require('../utils/logger');

// Express 글로벌 에러 핸들러 (반드시 app.use 마지막에 등록)
module.exports = function errorHandler(err, req, res, _next) {
  logger.error('ErrorHandler', err?.message || 'Unhandled error', err);

  let status = 500;
  if (err?.statusCode && Number.isInteger(err.statusCode)) {
    status = err.statusCode;
  } else if (err?.code === 'CIRCUIT_OPEN') {
    status = 503;
    res.set('Retry-After', String(Math.ceil((err.retryAfterMs || 30000) / 1000)));
  }

  // 환경과 무관하게 stack/내부 정보는 응답에 포함하지 않음
  res.status(status).json({
    error: status === 503 ? 'ServiceUnavailable' : 'InternalError',
    message: status === 503 ? 'Service temporarily unavailable' : 'Internal Server Error',
  });
};
