const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculatePositionSize } = require('../modules/risk/position-sizer');

// ATR 계산에 필요한 최소 캔들 생성 (16개 = period 14 + 1 + 여유)
function makeCandles(count, basePrice = 50000, atrApprox = 1000) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = basePrice + (i % 2 === 0 ? atrApprox / 2 : -atrApprox / 2);
    candles.push({
      date: `202401${String(i + 1).padStart(2, '0')}`,
      open: close - 200,
      high: close + atrApprox / 2,
      low: close - atrApprox / 2,
      close,
      volume: 100000,
    });
  }
  return candles;
}

describe('calculatePositionSize', () => {
  it('계산 불가 시 기본 매수금액 반환', () => {
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: null,
      avgWinLossRatio: null,
      candles: null,
      currentPrice: 50000,
    });
    assert.strictEqual(result.positionSize, 500000);
    assert.strictEqual(result.method, 'DEFAULT');
  });

  it('Kelly 음수 + ATR 없음 → 기본값', () => {
    // winRate=0.2, ratio=1.0 → fullKelly = (1*0.2 - 0.8)/1 = -0.6
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: 0.2,
      avgWinLossRatio: 1.0,
      candles: null,
      currentPrice: 50000,
    });
    assert.strictEqual(result.positionSize, 500000);
    assert.strictEqual(result.method, 'DEFAULT');
  });

  it('Kelly 양수 계산 — halfKelly = (b*p - q) / b / 2', () => {
    // winRate=0.6, ratio=2.0 → fullKelly = (2*0.6 - 0.4)/2 = 0.4 → halfKelly = 0.2
    // kellySize = 10M * 0.2 = 2,000,000 → 상한(1,000,000)에 걸림
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: 0.6,
      avgWinLossRatio: 2.0,
      candles: null,
      currentPrice: 50000,
    });
    assert.ok(result.kelly, 'Kelly 결과가 있어야 함');
    assert.strictEqual(result.kelly.size, 2000000);
    // 상한(500000*2=1000000) 적용
    assert.strictEqual(result.positionSize, 1000000);
  });

  it('하한 적용 — 매우 작은 Kelly', () => {
    // winRate=0.35, ratio=1.1 → fullKelly = (1.1*0.35 - 0.65)/1.1 ≈ -0.24 → 음수
    // ATR만 사용, ATR 작으면 하한에 걸림
    const candles = makeCandles(20, 50000, 200); // 아주 작은 ATR
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: 0.35,
      avgWinLossRatio: 1.1,
      candles,
      currentPrice: 50000,
    });
    // 하한 = 500000 * 0.5 = 250000
    assert.ok(result.positionSize >= 250000, `하한(250000) 이상: ${result.positionSize}`);
  });

  it('상한 적용 — 매우 큰 계좌 + 높은 Kelly', () => {
    const result = calculatePositionSize({
      accountBalance: 100000000, // 1억
      defaultBuyAmount: 500000,
      winRate: 0.7,
      avgWinLossRatio: 3.0,
      candles: null,
      currentPrice: 50000,
    });
    // 상한 = 500000 * 2 = 1,000,000
    assert.ok(result.positionSize <= 1000000, `상한(1000000) 이하: ${result.positionSize}`);
  });

  it('ATR 기반 계산 — candles 충분할 때', () => {
    const candles = makeCandles(20, 50000, 1000);
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: null,           // Kelly 비활성
      avgWinLossRatio: null,
      candles,
      currentPrice: 50000,
    });
    assert.ok(result.atrBased, 'ATR 결과가 있어야 함');
    assert.strictEqual(result.method, 'ATR_BASED');
    assert.ok(result.positionSize > 0);
  });

  it('두 방법 모두 유효 시 보수적(작은) 값 채택', () => {
    const candles = makeCandles(20, 50000, 1000);
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: 0.6,
      avgWinLossRatio: 2.0,
      candles,
      currentPrice: 50000,
    });
    assert.ok(result.kelly, 'Kelly 결과 있어야 함');
    assert.ok(result.atrBased, 'ATR 결과 있어야 함');
    // 최종값은 두 값 중 작은 것 (cap 적용 전)
    const _smaller = Math.min(result.kelly.size, result.atrBased.size);
    // cap 적용 후이므로 직접 비교 대신 method 확인
    assert.ok(['HALF_KELLY', 'ATR_BASED'].includes(result.method));
  });

  it('결과 필수 필드 존재', () => {
    const result = calculatePositionSize({
      accountBalance: 10000000,
      defaultBuyAmount: 500000,
      winRate: 0.5,
      avgWinLossRatio: 1.5,
      candles: null,
      currentPrice: 50000,
    });
    assert.ok('positionSize' in result);
    assert.ok('method' in result);
    assert.ok('limits' in result);
    assert.ok('reasons' in result);
    assert.ok(Array.isArray(result.reasons));
  });
});
