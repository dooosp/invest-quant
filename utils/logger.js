const PREFIX = '[InvestQuant]';

function formatTime() {
  return new Date().toISOString().slice(11, 19);
}

// --- 시크릿 마스킹 ---
const SENSITIVE_KEYS = new Set([
  'authorization', 'cookie', 'set-cookie',
  'crtfc_key', 'appkey', 'appsecret',
  'access_token', 'refresh_token', 'token',
]);

function maskStr(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/crtfc_key=[^&\s]+/gi, 'crtfc_key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/(appkey|appsecret|token|access_token|refresh_token)[=:]\s*["']?[^"'\s,}]+/gi, '$1=***');
}

function maskObj(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') return maskStr(obj);
  if (Array.isArray(obj)) return obj.map(maskObj);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) {
      out[k] = '***';
    } else {
      out[k] = maskObj(v);
    }
  }
  return out;
}

function safeErr(err) {
  if (!err) return '';
  return maskObj({
    message: err.message,
    code: err.code,
    stack: err.stack,
    response: err.response ? {
      status: err.response.status,
      data: err.response.data,
    } : undefined,
    config: err.config ? {
      url: err.config.url,
      method: err.config.method,
    } : undefined,
  });
}

const logger = {
  info(module, msg) {
    console.log(`${PREFIX}[${module}] ${formatTime()} ${maskStr(msg)}`);
  },
  warn(module, msg) {
    console.warn(`${PREFIX}[${module}] ${formatTime()} WARN: ${maskStr(msg)}`);
  },
  error(module, msg, err) {
    const detail = err ? safeErr(err) : '';
    console.error(`${PREFIX}[${module}] ${formatTime()} ERROR: ${maskStr(msg)}`, detail);
  },
};

module.exports = logger;
