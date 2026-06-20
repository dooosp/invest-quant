const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const config = require('../config');
const { adviseBuy } = require('../modules/integration/advisory-engine');

describe('adviseBuy Graham Gate', () => {
  let originalAxiosGet;

  beforeEach(() => {
    originalAxiosGet = axios.get;
    config.grahamGate.enabled = true;
    config.grahamGate.baseUrl = 'http://graham-gate.test';
    config.grahamGate.persistSnapshots = true;
  });

  afterEach(() => {
    axios.get = originalAxiosGet;
  });

  it('rejects buy advice before factor/risk approval when Graham Gate fails', async () => {
    axios.get = async () => ({
      data: {
        grahamGate: {
          passed: false,
          reasons: ['defensive investor criteria failed'],
          valueSnapshot: {
            schemaVersion: 'valueSnapshot.v1',
            stockCode: '005930',
            decision: 'REJECT',
          },
        },
      },
    });

    const result = await adviseBuy({
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 70000,
      technicalScore: 100,
      holdings: [],
      accountBalance: 10000000,
      winRate: 0.9,
      avgWinLossRatio: 3,
    });

    assert.equal(result.approved, false);
    assert.equal(result.reasonCode, 'GRAHAM_GATE_REJECT');
    assert.equal(result.valueSnapshot.schemaVersion, 'valueSnapshot.v1');
    assert.match(result.reason, /defensive investor/);
  });

  it('fails closed when Graham Gate is unavailable', async () => {
    axios.get = async () => {
      throw new Error('timeout');
    };

    const result = await adviseBuy({
      stockCode: '005930',
      currentPrice: 70000,
      technicalScore: 100,
      holdings: [],
      accountBalance: 10000000,
    });

    assert.equal(result.approved, false);
    assert.equal(result.reasonCode, 'GRAHAM_GATE_UNAVAILABLE');
    assert.equal(result.valueSnapshot.decision, 'REJECT');
    assert.match(result.reason, /Graham Gate unavailable/);
  });
});
