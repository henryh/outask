import { databaseSync } from './sqlite.mjs';

export const cacheUnavailable = Object.freeze({
  code: 'CACHE_UNAVAILABLE',
  message: 'SQLite cache acceleration is unavailable; authoritative JSON was used.',
});
export const cacheFallback = Object.freeze({
  code: 'CACHE_FALLBACK',
  message: 'A current SQLite cache was unavailable; authoritative JSON was used while a refresh was requested.',
});

let support;

export function checkCacheOptions(noCache, onAdvisory) {
  if (typeof noCache !== 'boolean') throw Object.assign(new Error('noCache must be a boolean'), { code: 'INVALID_INPUT' });
  if (onAdvisory !== undefined && typeof onAdvisory !== 'function') {
    throw Object.assign(new Error('onAdvisory must be a function'), { code: 'INVALID_INPUT' });
  }
}

export function advise(onAdvisory, advisory) {
  onAdvisory?.(advisory);
}

export function onceAdvisory(onAdvisory) {
  let sent = false;
  return (advisory) => {
    if (sent) return;
    sent = true;
    advise(onAdvisory, advisory);
  };
}

export function cacheSupported(onAdvisory) {
  if (support === undefined) {
    let database;
    try {
      const DatabaseSync = databaseSync();
      database = new DatabaseSync(':memory:');
      database.exec('SELECT 1');
      support = true;
    } catch {
      support = false;
    } finally {
      try { database?.close(); } catch { support = false; }
    }
  }
  if (!support) advise(onAdvisory, cacheUnavailable);
  return support;
}
