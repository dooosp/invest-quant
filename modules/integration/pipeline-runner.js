/**
 * 퀀트 파이프라인 오케스트레이터
 *
 * Spec → Data → Factors → Portfolio → Backtest → Report
 * 각 단계 실패 시 즉시 중단 (fail-closed)
 */
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const bridge = require('../factor/python-bridge');

const MOD = 'Pipeline';
const BASE_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const RUNS_DIR = path.join(BASE_DIR, 'runs');

async function run(specPath) {
  const startTime = Date.now();
  specPath = path.resolve(specPath);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  const strategyName = spec.name || 'unnamed';
  const today = new Date().toISOString().slice(0, 10);
  const runId = `${today}_${strategyName}`;
  const runDir = path.join(RUNS_DIR, runId);
  const processedDir = path.join(DATA_DIR, 'processed', strategyName);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  // 스펙 복사 (재현성)
  fs.copyFileSync(specPath, path.join(runDir, 'strategy_spec.json'));

  const status = { runId, strategy: strategyName, steps: [], error: null };

  try {
    // Step 1: Data Agent
    logger.info(MOD, `[1/5] Data Agent 실행`);
    await bridge.runDataAgent(specPath, DATA_DIR, processedDir);
    status.steps.push({ step: 'data', status: 'ok' });

    // Step 2: Factor Agent
    logger.info(MOD, `[2/5] Factor Agent 실행`);
    await bridge.runFactorAgent(specPath, processedDir, processedDir);
    status.steps.push({ step: 'factor', status: 'ok' });

    // Step 3: Portfolio Agent
    logger.info(MOD, `[3/5] Portfolio Agent 실행`);
    await bridge.runPortfolioAgent(specPath, processedDir, processedDir);
    status.steps.push({ step: 'portfolio', status: 'ok' });

    const weightsPath = path.join(processedDir, 'weights.json');

    // Step 4: Backtest Agent
    logger.info(MOD, `[4/5] Backtest Agent 실행`);
    await bridge.runBacktestAgent(specPath, processedDir, weightsPath, runDir);
    status.steps.push({ step: 'backtest', status: 'ok' });

    // Step 5: Reporter Agent
    logger.info(MOD, `[5/5] Reporter Agent 실행`);
    const signalsPath = path.join(processedDir, 'signals.csv');
    await bridge.runReporterAgent(runDir, signalsPath, weightsPath);
    status.steps.push({ step: 'report', status: 'ok' });

    status.duration_ms = Date.now() - startTime;
    logger.info(MOD, `완료: ${runId} (${status.duration_ms}ms)`);

  } catch (error) {
    status.error = error.message;
    status.duration_ms = Date.now() - startTime;
    logger.error(MOD, `실패: ${error.message}`);
  }

  // 상태 저장
  fs.writeFileSync(path.join(runDir, 'pipeline_status.json'), JSON.stringify(status, null, 2));
  return status;
}

// CLI 직접 실행
if (require.main === module) {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('Usage: node pipeline-runner.js <strategy_spec.json>');
    process.exit(1);
  }
  run(path.resolve(specPath))
    .then(s => console.log(JSON.stringify(s, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run };
