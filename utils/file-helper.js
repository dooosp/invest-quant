const fs = require('fs');
const path = require('path');

/**
 * JSON 데이터 로드 (원자적 읽기 + 백업 복구)
 * auto-trader loadData 패턴 재사용
 */
function loadData(filePath) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  const backupPath = fullPath + '.backup';

  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (_error) {
    console.error(`[FileHelper] 파일 손상: ${filePath}`);
    if (fs.existsSync(backupPath)) {
      try {
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        const data = JSON.parse(backupContent);
        fs.writeFileSync(fullPath, backupContent, 'utf8');
        console.log(`[FileHelper] 백업에서 복구: ${filePath}`);
        return data;
      } catch (_e) {
        console.error(`[FileHelper] 백업도 손상: ${filePath}`);
      }
    }
    const corruptedPath = fullPath + '.corrupted.' + Date.now();
    fs.renameSync(fullPath, corruptedPath);
  }
  return null;
}

/**
 * JSON 데이터 저장 (원자적 쓰기: tmp → rename)
 */
function saveData(filePath, data) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  const backupPath = fullPath + '.backup';
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(fullPath)) {
    fs.copyFileSync(fullPath, backupPath);
  }

  const tmpPath = fullPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, fullPath);
}

/**
 * 캐시 파일 로드 (TTL 기반)
 * @param {string} filePath - 파일 경로
 * @param {number} maxAgeDays - 최대 유효 기간 (일)
 * @returns {object|null}
 */
function loadCache(filePath, maxAgeDays) {
  const data = loadData(filePath);
  if (!data || !data._cachedAt) return null;

  const cachedAt = new Date(data._cachedAt);
  const ageMs = Date.now() - cachedAt.getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  if (ageMs > maxAgeMs) {
    return null; // 캐시 만료
  }
  return data;
}

/**
 * 캐시 파일 저장 (타임스탬프 포함)
 */
function saveCache(filePath, data) {
  saveData(filePath, { ...data, _cachedAt: new Date().toISOString() });
}

module.exports = { loadData, saveData, loadCache, saveCache };
