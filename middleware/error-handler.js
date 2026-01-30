'use strict';
const logger = require('../utils/logger');

// Express 글로벌 에러 핸들러 (반드시 app.use 마지막에 등록)
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  const env = process.env.NODE_ENV || 'development';
  logger.error('ErrorHandler', err?.message || 'Unhandled error', err);

  const status =
    err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;

  const body = {
    error: 'InternalError',
    message: env === 'development' ? (err?.message || 'Error') : 'Internal Server Error',
  };
  if (env === 'development' && err?.stack) body.stack = err.stack;

  res.status(status).json(body);
};
