const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CircuitBreaker, CircuitOpenError } = require('../utils/circuit-breaker');

describe('CircuitBreaker', () => {
  it('CLOSED 상태에서 성공 호출', async () => {
    const cb = new CircuitBreaker('test');
    const result = await cb.call(() => Promise.resolve(42));
    assert.strictEqual(result, 42);
    assert.strictEqual(cb.state, 'CLOSED');
    assert.strictEqual(cb.failures, 0);
  });

  it('실패 1회 — CLOSED 유지', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3 });
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('fail'))));
    assert.strictEqual(cb.state, 'CLOSED');
    assert.strictEqual(cb.failures, 1);
  });

  it('연속 3회 실패 → OPEN', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3 });
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => cb.call(() => Promise.reject(new Error('fail'))));
    }
    assert.strictEqual(cb.state, 'OPEN');
    assert.strictEqual(cb.failures, 3);
  });

  it('OPEN 상태에서 즉시 호출 차단 (CircuitOpenError)', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetTimeout: 60000 });
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('fail'))));
    assert.strictEqual(cb.state, 'OPEN');

    await assert.rejects(
      () => cb.call(() => Promise.resolve('should not run')),
      (err) => {
        assert.ok(err instanceof CircuitOpenError);
        assert.strictEqual(err.code, 'CIRCUIT_OPEN');
        assert.ok(err.retryAfterMs > 0);
        return true;
      }
    );
  });

  it('OPEN → resetTimeout 경과 후 → HALF_OPEN → 성공 → CLOSED', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetTimeout: 10 });
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('fail'))));
    assert.strictEqual(cb.state, 'OPEN');

    // resetTimeout 대기
    await new Promise(r => setTimeout(r, 20));

    const result = await cb.call(() => Promise.resolve('recovered'));
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(cb.state, 'CLOSED');
    assert.strictEqual(cb.failures, 0);
  });

  it('HALF_OPEN에서 다시 실패 → OPEN 복귀', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetTimeout: 10 });
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('fail'))));

    await new Promise(r => setTimeout(r, 20));

    await assert.rejects(() => cb.call(() => Promise.reject(new Error('still broken'))));
    assert.strictEqual(cb.state, 'OPEN');
  });

  it('성공이 failure 카운터를 리셋', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3 });
    // 2회 실패
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('f1'))));
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('f2'))));
    assert.strictEqual(cb.failures, 2);

    // 1회 성공 → 리셋
    await cb.call(() => Promise.resolve('ok'));
    assert.strictEqual(cb.failures, 0);
    assert.strictEqual(cb.state, 'CLOSED');

    // 다시 2회 실패해도 CLOSED
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('f3'))));
    await assert.rejects(() => cb.call(() => Promise.reject(new Error('f4'))));
    assert.strictEqual(cb.state, 'CLOSED');
  });
});
