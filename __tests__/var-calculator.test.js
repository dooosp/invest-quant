const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateVaR, calculatePortfolioVaR } = require('../modules/risk/var-calculator');

describe('calculateVaR', () => {
  it('데이터 20일 미만이면 null', () => {
    assert.strictEqual(calculateVaR([0.01, -0.01]), null);
    assert.strictEqual(calculateVaR(null), null);
    assert.strictEqual(calculateVaR([]), null);
  });

  it('데이터 정확히 20일이면 계산 가능', () => {
    const returns = Array.from({ length: 20 }, (_, i) => (i - 10) * 0.005);
    const result = calculateVaR(returns);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.dataPoints, 20);
  });

  it('모든 수익률 동일 시 VaR = 해당 값', () => {
    const returns = Array(30).fill(-0.01);
    const result = calculateVaR(returns);
    assert.strictEqual(result.var95, -1); // -0.01 * 100
    assert.strictEqual(result.var99, -1);
    assert.strictEqual(result.worstDay, -1);
  });

  it('VaR95 >= VaR99 (99%가 더 극단)', () => {
    // 정규분포 유사 데이터
    const returns = [];
    for (let i = 0; i < 100; i++) {
      returns.push((Math.sin(i) * 0.03)); // -3% ~ +3% 범위
    }
    const result = calculateVaR(returns);
    assert.ok(result.var95 >= result.var99,
      `VaR95(${result.var95}) >= VaR99(${result.var99}) 이어야 함`);
  });

  it('CVaR은 VaR보다 같거나 작음 (꼬리 평균)', () => {
    const returns = [];
    for (let i = 0; i < 100; i++) returns.push((i - 50) * 0.001);
    const result = calculateVaR(returns);
    assert.ok(result.cvar95 <= result.var95,
      `CVaR95(${result.cvar95}) <= VaR95(${result.var95})`);
  });

  it('결과에 필수 필드 존재', () => {
    const returns = Array.from({ length: 50 }, (_, i) => (i - 25) * 0.002);
    const result = calculateVaR(returns);
    const keys = ['var95', 'var99', 'cvar95', 'cvar99', 'worstDay', 'avgReturn', 'dataPoints'];
    for (const k of keys) {
      assert.ok(k in result, `필수 필드 누락: ${k}`);
    }
  });
});

describe('calculatePortfolioVaR', () => {
  it('빈 holdings이면 null', () => {
    assert.strictEqual(calculatePortfolioVaR([]), null);
    assert.strictEqual(calculatePortfolioVaR(null), null);
  });

  it('데이터 부족 시 null', () => {
    const result = calculatePortfolioVaR([
      { code: '005930', weight: 1, dailyReturns: [0.01, -0.01] },
    ]);
    assert.strictEqual(result, null);
  });

  it('단일 종목 100% — 개별 VaR와 동일', () => {
    const returns = Array.from({ length: 50 }, (_, i) => (i - 25) * 0.002);
    const individual = calculateVaR(returns);
    const portfolio = calculatePortfolioVaR([
      { code: '005930', weight: 1, dailyReturns: returns },
    ]);
    assert.strictEqual(portfolio.var95, individual.var95);
    assert.strictEqual(portfolio.var99, individual.var99);
  });
});
