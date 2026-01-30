const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculatePerformance } = require('../modules/backtest/performance-calc');

// --- 헬퍼: 등가 곡선 생성 ---
function makeEquityCurve(values) {
  return values.map((v, i) => ({ date: `2024010${i + 1}`, value: v }));
}

describe('calculatePerformance', () => {
  it('데이터 부족 시 error 반환', () => {
    const result = calculatePerformance({
      trades: [], equityCurve: [{ date: '20240101', value: 1000 }],
      finalValue: 1000, initialCapital: 1000,
    });
    assert.strictEqual(result.error, '데이터 부족');
  });

  it('수익 0% — 횡보 시 totalReturn 0', () => {
    const result = calculatePerformance({
      trades: [],
      equityCurve: makeEquityCurve([10000000, 10000000, 10000000]),
      finalValue: 10000000,
      initialCapital: 10000000,
    });
    assert.strictEqual(result.totalReturn, 0);
    assert.strictEqual(result.maxDrawdown, 0);
  });

  it('수익 +10% 정확히 계산', () => {
    const result = calculatePerformance({
      trades: [],
      equityCurve: makeEquityCurve([10000000, 10500000, 11000000]),
      finalValue: 11000000,
      initialCapital: 10000000,
    });
    assert.strictEqual(result.totalReturn, 10);
    assert.strictEqual(result.finalValue, 11000000);
  });

  it('MDD 계산 — 고점 대비 최대 하락', () => {
    // 고점 120 → 저점 90 → MDD = (120-90)/120 = 25%
    const result = calculatePerformance({
      trades: [],
      equityCurve: makeEquityCurve([100, 120, 90, 110]),
      finalValue: 110,
      initialCapital: 100,
    });
    assert.strictEqual(result.maxDrawdown, 25);
  });

  it('승률/profitFactor — 매도 트레이드 기준', () => {
    const trades = [
      { type: 'BUY', date: '20240101', profitRate: 0 },
      { type: 'SELL', date: '20240102', profitRate: 0.05 },  // 승
      { type: 'BUY', date: '20240103', profitRate: 0 },
      { type: 'SELL', date: '20240104', profitRate: -0.02 }, // 패
    ];
    const result = calculatePerformance({
      trades,
      equityCurve: makeEquityCurve([100, 105, 103, 103]),
      finalValue: 103,
      initialCapital: 100,
    });
    assert.strictEqual(result.winRate, 50);         // 1/2
    assert.strictEqual(result.profitFactor, 2.5);   // 0.05 / 0.02
    assert.strictEqual(result.totalTrades, 2);       // BUY 2건
    assert.strictEqual(result.sellTrades, 2);
  });

  it('Sharpe Ratio — 일정 수익 시 양수', () => {
    // 매일 0.1% 상승 → Sharpe > 0
    const vals = [10000000];
    for (let i = 1; i < 30; i++) vals.push(Math.round(vals[i - 1] * 1.001));
    const result = calculatePerformance({
      trades: [],
      equityCurve: makeEquityCurve(vals),
      finalValue: vals[vals.length - 1],
      initialCapital: vals[0],
    });
    assert.ok(result.sharpeRatio > 0, `Sharpe가 양수여야 함: ${result.sharpeRatio}`);
    // 일정 상승만 있으면 하방편차 0 → Sortino=0 이 정상
    assert.strictEqual(result.sortinoRatio, 0);
  });

  it('Sortino Ratio — 변동 있는 수익 시 양수', () => {
    // 상승+하락 혼합 but 전체 우상향
    const vals = [10000000, 10200000, 10100000, 10400000, 10300000,
                  10600000, 10500000, 10800000, 10700000, 11000000];
    const result = calculatePerformance({
      trades: [],
      equityCurve: makeEquityCurve(vals),
      finalValue: vals[vals.length - 1],
      initialCapital: vals[0],
    });
    assert.ok(result.sortinoRatio > 0, `Sortino가 양수여야 함: ${result.sortinoRatio}`);
  });
});
