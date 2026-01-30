const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _safeDiv: safeDiv, _safePct: safePct } = require('../modules/fundamental/ratio-calculator');

describe('safeDiv', () => {
  it('정상 나눗셈 — 소수점 2자리 반올림', () => {
    assert.strictEqual(safeDiv(100, 3), 33.33);
  });

  it('분모 0이면 null', () => {
    assert.strictEqual(safeDiv(100, 0), null);
  });

  it('분자 null이면 null', () => {
    assert.strictEqual(safeDiv(null, 10), null);
  });

  it('분모 null이면 null', () => {
    assert.strictEqual(safeDiv(10, null), null);
  });

  it('분자·분모 모두 0이면 null', () => {
    assert.strictEqual(safeDiv(0, 0), null);
  });

  it('음수 나눗셈', () => {
    assert.strictEqual(safeDiv(-100, 50), -2);
  });

  it('양수 정확한 값', () => {
    assert.strictEqual(safeDiv(10, 2), 5);
  });
});

describe('safePct', () => {
  it('100 / 200 = 50%', () => {
    assert.strictEqual(safePct(100, 200), 50);
  });

  it('1 / 3 = 33.33%', () => {
    assert.strictEqual(safePct(1, 3), 33.33);
  });

  it('분모 0이면 null', () => {
    assert.strictEqual(safePct(100, 0), null);
  });

  it('분자 null이면 null', () => {
    assert.strictEqual(safePct(null, 200), null);
  });

  it('음수 비율 (적자)', () => {
    assert.strictEqual(safePct(-50, 200), -25);
  });
});
