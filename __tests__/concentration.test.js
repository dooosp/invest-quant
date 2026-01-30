const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeConcentration } = require('../modules/risk/concentration');

describe('analyzeConcentration', () => {
  it('빈 배열이면 EMPTY', () => {
    const r = analyzeConcentration([]);
    assert.strictEqual(r.level, 'EMPTY');
    assert.strictEqual(r.hhi, 0);
  });

  it('null이면 EMPTY', () => {
    const r = analyzeConcentration(null);
    assert.strictEqual(r.level, 'EMPTY');
  });

  it('단일 종목 100% → HHI=10000, HIGHLY_CONCENTRATED', () => {
    const r = analyzeConcentration([
      { code: '005930', name: '삼성전자', value: 10000000 },
    ]);
    assert.strictEqual(r.hhi, 10000);
    assert.strictEqual(r.level, 'HIGHLY_CONCENTRATED');
    assert.strictEqual(r.holdingCount, 1);
  });

  it('2종목 50:50 → HHI=5000, HIGHLY_CONCENTRATED', () => {
    const r = analyzeConcentration([
      { code: '005930', name: '삼성전자', value: 5000000 },
      { code: '000660', name: 'SK하이닉스', value: 5000000 },
    ]);
    assert.strictEqual(r.hhi, 5000);
    assert.strictEqual(r.level, 'HIGHLY_CONCENTRATED');
  });

  it('10종목 균등 분산 → HHI=1000, DIVERSIFIED', () => {
    const holdings = [];
    const codes = ['005930', '000660', '035420', '035720', '005380',
                   '000270', '105560', '055550', '207940', '051910'];
    for (const code of codes) {
      holdings.push({ code, name: code, value: 1000000 });
    }
    const r = analyzeConcentration(holdings);
    assert.strictEqual(r.hhi, 1000);
    assert.strictEqual(r.level, 'DIVERSIFIED');
    assert.strictEqual(r.holdingCount, 10);
  });

  it('섹터 집중도 40% 초과 시 HIGH 경고', () => {
    // TECH 3종목 = 70%, AUTO 1종목 = 30%
    const r = analyzeConcentration([
      { code: '005930', name: '삼성전자', value: 3000000 },
      { code: '000660', name: 'SK하이닉스', value: 2000000 },
      { code: '035420', name: '네이버', value: 2000000 },
      { code: '005380', name: '현대차', value: 3000000 },
    ]);
    const techWarning = r.sectorWarnings.find(w => w.sector === 'TECH');
    assert.ok(techWarning, 'TECH 섹터 경고가 있어야 함');
    assert.strictEqual(techWarning.level, 'HIGH');
  });

  it('단일 종목 비중 30% 초과 시 singleStockWarning HIGH', () => {
    const r = analyzeConcentration([
      { code: '005930', name: '삼성전자', value: 7000000 },
      { code: '000660', name: 'SK하이닉스', value: 3000000 },
    ]);
    assert.ok(r.singleStockWarning, '단일 종목 경고가 있어야 함');
    assert.strictEqual(r.singleStockWarning.level, 'HIGH');
    assert.strictEqual(r.singleStockWarning.code, '005930');
  });

  it('totalValue가 0이면 EMPTY', () => {
    const r = analyzeConcentration([
      { code: '005930', name: '삼성전자', value: 0 },
    ]);
    assert.strictEqual(r.level, 'EMPTY');
  });
});
