const PREFIX = '[InvestQuant]';

function formatTime() {
  return new Date().toISOString().slice(11, 19);
}

const logger = {
  info(module, msg) {
    console.log(`${PREFIX}[${module}] ${formatTime()} ${msg}`);
  },
  warn(module, msg) {
    console.warn(`${PREFIX}[${module}] ${formatTime()} WARN: ${msg}`);
  },
  error(module, msg, err) {
    const detail = err ? ` | ${err.message || err}` : '';
    console.error(`${PREFIX}[${module}] ${formatTime()} ERROR: ${msg}${detail}`);
  },
};

module.exports = logger;
