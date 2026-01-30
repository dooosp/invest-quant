'use strict';

class CircuitOpenError extends Error {
  constructor(name, retryAfterMs) {
    super(`CircuitBreaker[${name}] OPEN`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.retryAfterMs = retryAfterMs;
  }
}

class CircuitBreaker {
  constructor(name, { threshold = 3, resetTimeout = 30000 } = {}) {
    this.name = name;
    this.failures = 0;
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
    this.state = 'CLOSED'; // CLOSED → OPEN → HALF_OPEN
    this.nextAttempt = 0;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now < this.nextAttempt) {
        throw new CircuitOpenError(this.name, this.nextAttempt - now);
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.threshold) {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.resetTimeout;
      }
      throw err;
    }
  }
}

module.exports = { CircuitBreaker, CircuitOpenError };
