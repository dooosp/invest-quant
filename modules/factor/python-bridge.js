/**
 * Node → Python 워커 호출 브릿지
 * child_process.execFile로 Python 스크립트 실행, JSON stdio 통신
 */
const { execFile } = require('child_process');
const path = require('path');
const logger = require('../../utils/logger');

const MOD = 'PyBridge';
const PYTHON = 'python3';
const PYTHON_DIR = path.join(__dirname, '..', '..', 'python');
const TIMEOUT = 60000; // 60초

function runPython(script, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PYTHON_DIR, script);
    const opts = { timeout: TIMEOUT, cwd: PYTHON_DIR, maxBuffer: 10 * 1024 * 1024 };

    logger.info(MOD, `실행: ${script} ${args.join(' ')}`);

    execFile(PYTHON, [scriptPath, ...args], opts, (error, stdout, stderr) => {
      if (stderr) logger.info(MOD, stderr.trim());
      if (error) {
        logger.error(MOD, `실패: ${script} — ${error.message}`);
        return reject(new Error(`${script} failed: ${error.message}\n${stderr}`));
      }
      resolve(stdout.trim());
    });
  });
}

async function runDataAgent(specPath, dataDir, outputDir) {
  return runPython('data_agent.py', ['--spec', specPath, '--data-dir', dataDir, '--output', outputDir]);
}

async function runFactorAgent(specPath, inputDir, outputDir) {
  return runPython('factor_agent.py', ['--spec', specPath, '--input', inputDir, '--output', outputDir]);
}

async function runPortfolioAgent(specPath, inputDir, outputDir, prevWeights = null) {
  const args = ['--spec', specPath, '--input', inputDir, '--output', outputDir];
  if (prevWeights) args.push('--prev-weights', prevWeights);
  return runPython('portfolio_agent.py', args);
}

async function runBacktestAgent(specPath, dataDir, weightsPath, outputDir) {
  return runPython('backtest_agent.py', [
    '--spec', specPath, '--data-dir', dataDir, '--weights', weightsPath, '--output', outputDir,
  ]);
}

async function runReporterAgent(runDir, signalsPath, weightsPath) {
  const args = ['--run-dir', runDir];
  if (signalsPath) args.push('--signals', signalsPath);
  if (weightsPath) args.push('--weights', weightsPath);
  return runPython('reporter_agent.py', args);
}

module.exports = { runPython, runDataAgent, runFactorAgent, runPortfolioAgent, runBacktestAgent, runReporterAgent };
