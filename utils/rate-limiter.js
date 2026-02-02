'use strict';

/**
 * O(1) fixed-window rate limiter (외부 의존성 0)
 * 프로덕션 확장 시 express-rate-limit 전환 가능.
 */
class RateLimiter {
  constructor({ windowMs = 60000, max = 30, cleanupMs = 300000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> { windowStart, count, lastSeen }
    this._timer = setInterval(() => this._cleanup(), cleanupMs).unref();
  }

  _cleanup() {
    const now = Date.now();
    for (const [k, v] of this.hits) {
      if (now - v.lastSeen > this.windowMs * 5) this.hits.delete(k);
    }
  }

  middleware() {
    return (req, res, next) => {
      const key = req.headers['x-api-key'] || req.ip;
      const now = Date.now();
      let rec = this.hits.get(key);

      if (!rec || now - rec.windowStart >= this.windowMs) {
        rec = { windowStart: now, count: 0, lastSeen: now };
      }

      rec.count += 1;
      rec.lastSeen = now;
      this.hits.set(key, rec);

      if (rec.count > this.max) {
        res.set('Retry-After', String(Math.ceil(this.windowMs / 1000)));
        return res.status(429).json({ error: 'Too Many Requests' });
      }
      return next();
    };
  }
}

module.exports = { RateLimiter };
