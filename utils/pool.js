'use strict';

/**
 * 동시성 제한 병렬 실행 (외부 의존성 0)
 * @param {number} limit - 최대 동시 실행 수
 * @param {Array} items - 처리 대상 배열
 * @param {Function} worker - (item) => Promise
 * @returns {Promise<Array<PromiseSettledResult>>}
 */
async function asyncPool(limit, items, worker) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => worker(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(ret);
}

module.exports = { asyncPool };
