import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let databaseClass;

export function databaseSync() {
  if (databaseClass) return databaseClass;
  const emitWarning = process.emitWarning;
  process.emitWarning = function quietSqlite(warning, ...args) {
    if (warning === 'SQLite is an experimental feature and might change at any time'
      && args[0] === 'ExperimentalWarning') return;
    return Reflect.apply(emitWarning, this, [warning, ...args]);
  };
  try { ({ DatabaseSync: databaseClass } = require('node:sqlite')); }
  finally { process.emitWarning = emitWarning; }
  return databaseClass;
}
