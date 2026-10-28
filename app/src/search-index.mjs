import { cacheRoot } from './locations.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { projectBudget } from './input.mjs';
import { openProject, recordEntries, selectStoreFiles } from './stores.mjs';
import { databaseSync } from './sqlite.mjs';

const indexVersion = 7;
const staleLockMs = 30_000;
const refreshes = new Map();


export function searchIndexPaths(projectPath, env = process.env) {
  const root = resolve(projectPath);
  const key = createHash('sha256').update(root).digest('hex');
  const directory = join(cacheRoot(env), key);
  return { directory, pointer: join(directory, 'current.json'), lock: join(directory, 'refresh.sqlite') };
}

function fileState(path) {
  try {
    const stat = statSync(path, { bigint: true });
    return stat.isFile() ? {
      size: String(stat.size), mtime_ns: String(stat.mtimeNs), ctime_ns: String(stat.ctimeNs), ino: String(stat.ino),
    } : { kind: 'not-file' };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { error: error.code };
  }
}

function sourceState(project, files) {
  return {
    schema: project.budget.fingerprints?.[project.schemaPath] ?? null,
    stores: Object.fromEntries(files.map((file) => [file, fileState(join(project.directory, file))])),
  };
}

function generation(state) {
  return createHash('sha256').update(JSON.stringify({ version: indexVersion, state })).digest('hex');
}

function openCurrent(project, state, env) {
  const paths = searchIndexPaths(project.root, env);
  let pointer;
  try {
    pointer = JSON.parse(readFileSync(paths.pointer, 'utf8'));
  } catch {
    return undefined;
  }
  const expected = generation(state);
  if (pointer?.version !== indexVersion || pointer.generation !== expected
    || typeof pointer.database !== 'string' || basename(pointer.database) !== pointer.database
    || !/^index-[a-f0-9]{64}\.sqlite$/.test(pointer.database)) return undefined;
  let database;
  try {
    const DatabaseSync = databaseSync();
    database = new DatabaseSync(join(paths.directory, pointer.database), { readOnly: true });
    const getMeta = database.prepare('SELECT value FROM meta WHERE key = ?');
    const version = getMeta.get('version');
    const meta = getMeta.get('generation');
    if (version?.value !== String(indexVersion) || meta?.value !== expected) {
      database.close();
      return undefined;
    }
    database.prepare('SELECT seq, id, store, status, title_key, priority_rank, fields, task FROM tasks LIMIT 0').all();
    database.prepare('SELECT store, status, field, first_seq, field_pos FROM available LIMIT 0').all();
    database.prepare('SELECT store, status, field, kind FROM sort_types LIMIT 0').all();
    database.prepare('SELECT text, field, task_row FROM search LIMIT 0').all();
    return database;
  } catch {
    database?.close();
    return undefined;
  }
}

function scalarTexts(value) {
  const texts = [];
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || ['string', 'number', 'boolean'].includes(typeof current)) {
      texts.push(String(current));
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) pending.push(current[index]);
    } else if (typeof current === 'object') {
      for (const entry of Object.values(current)) pending.push(entry);
    }
  }
  return texts;
}

function textKey(value) {
  const key = Buffer.allocUnsafe(value.length * 2);
  for (let index = 0; index < value.length; index++) key.writeUInt16BE(value.charCodeAt(index), index * 2);
  return key;
}

function buildDatabase(path, project, entries, state, value) {
  const DatabaseSync = databaseSync();
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE tasks (
        seq INTEGER PRIMARY KEY, id INTEGER NOT NULL, store TEXT NOT NULL, status TEXT NOT NULL,
        title_key BLOB NOT NULL, priority_rank INTEGER NOT NULL, fields TEXT NOT NULL, task TEXT NOT NULL
      ) STRICT;
      CREATE INDEX tasks_selection ON tasks (store, status, seq);
      CREATE INDEX tasks_id ON tasks (id);
      CREATE INDEX tasks_title_asc ON tasks (title_key ASC, id ASC);
      CREATE INDEX tasks_title_desc ON tasks (title_key DESC, id ASC);
      CREATE INDEX tasks_priority_asc ON tasks (priority_rank ASC, id ASC);
      CREATE INDEX tasks_priority_desc ON tasks (priority_rank DESC, id ASC);
      CREATE TABLE available (
        store TEXT NOT NULL, status TEXT NOT NULL, field TEXT NOT NULL,
        first_seq INTEGER NOT NULL, field_pos INTEGER NOT NULL,
        PRIMARY KEY (store, status, field)
      ) STRICT;
      CREATE TABLE sort_types (
        store TEXT NOT NULL, status TEXT NOT NULL, field TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (store, status, field, kind)
      ) STRICT;
      CREATE VIRTUAL TABLE search USING fts5(text, field UNINDEXED, task_row UNINDEXED, tokenize='trigram');
    `);
    const addMeta = database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    const addTask = database.prepare('INSERT INTO tasks (seq, id, store, status, title_key, priority_rank, fields, task) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const addField = database.prepare(`
      INSERT OR IGNORE INTO available (store, status, field, first_seq, field_pos) VALUES (?, ?, ?, ?, ?)
    `);
    const addType = database.prepare('INSERT INTO sort_types (store, status, field, kind) VALUES (?, ?, ?, ?)');
    const addText = database.prepare('INSERT INTO search (text, field, task_row) VALUES (?, ?, ?)');
    database.exec('BEGIN');
    addMeta.run('version', String(indexVersion));
    addMeta.run('generation', value);
    addMeta.run('project', project.root);
    addMeta.run('sources', JSON.stringify(state));
    let seq = 0;
    const seenTypes = new Set();
    for (const entry of entries) {
      seq++;
      const names = Object.keys(entry.record);
      const rank = entry.record.priority === 'high' ? 0 : entry.record.priority === 'low' ? 2 : 1;
      addTask.run(seq, entry.record.id, entry.store, entry.record.status, textKey(entry.record.title), rank,
        JSON.stringify(names), JSON.stringify(entry.record));
      for (const [position, field] of names.entries()) {
        addField.run(entry.store, entry.record.status, field, seq, position);
        if (entry.record[field] !== null) {
          const kind = typeof entry.record[field] === 'number' ? 'number' : 'other';
          const key = JSON.stringify([entry.store, entry.record.status, field, kind]);
          if (!seenTypes.has(key)) {
            seenTypes.add(key);
            addType.run(entry.store, entry.record.status, field, kind);
          }
        }
        for (const text of scalarTexts(entry.record[field])) addText.run(text.toLowerCase(), field, seq);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    database.close();
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function lockDatabase(path) {
  const DatabaseSync = databaseSync();
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS refresh_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL,
        pid INTEGER NOT NULL, generation TEXT NOT NULL, started_ms INTEGER NOT NULL
      ) STRICT;
    `);
    chmodSync(path, 0o600);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function locked(path, operation) {
  let database;
  try {
    database = lockDatabase(path);
    database.exec('BEGIN IMMEDIATE');
    const result = operation(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database?.exec('ROLLBACK'); } catch {}
    if (error.code === 'ERR_SQLITE_ERROR' && error.errstr === 'database is locked') return undefined;
    throw error;
  } finally {
    database?.close();
  }
}

function acquire(path, value) {
  return locked(path, (database) => {
    const owner = database.prepare('SELECT token, pid, started_ms FROM refresh_lock WHERE id = 1').get();
    if (owner && (processAlive(Number(owner.pid)) || Date.now() - Number(owner.started_ms) < staleLockMs)) return undefined;
    const token = randomUUID();
    database.prepare(`
      INSERT INTO refresh_lock (id, token, pid, generation, started_ms) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET token=excluded.token, pid=excluded.pid,
        generation=excluded.generation, started_ms=excluded.started_ms
    `).run(token, process.pid, value, Date.now());
    return token;
  });
}

function claim(path, token, value) {
  if (typeof token !== 'string') return false;
  return locked(path, (database) => Number(database.prepare(`
    UPDATE refresh_lock SET pid = ?, generation = ?, started_ms = ? WHERE id = 1 AND token = ?
  `).run(process.pid, value, Date.now(), token).changes) === 1) ?? false;
}

function release(path, token) {
  if (typeof token !== 'string') return false;
  return locked(path, (database) => Number(database.prepare(
    'DELETE FROM refresh_lock WHERE id = 1 AND token = ?',
  ).run(token).changes) === 1) ?? false;
}

function projectSnapshot(projectPath, schemaPath) {
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, schemaPath);
  const { files } = selectStoreFiles(project, { stores: ['all'] });
  return { project, files, state: sourceState(project, files) };
}

export function refreshSearchIndex(projectPath, options = {}) {
  const { schemaPath, env = process.env, lockClaimed = false, lockToken } = options;
  let snapshot = projectSnapshot(projectPath, schemaPath);
  const value = generation(snapshot.state);
  const paths = searchIndexPaths(snapshot.project.root, env);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  let ownedToken = lockToken;
  if (lockClaimed) {
    if (!claim(paths.lock, ownedToken, value)) return false;
  } else {
    const current = openCurrent(snapshot.project, snapshot.state, env);
    if (current) {
      current.close();
      return false;
    }
    ownedToken = acquire(paths.lock, value);
    if (!ownedToken) return false;
  }
  const temporary = join(paths.directory, `.index-${process.pid}-${randomUUID()}.sqlite`);
  const pointer = join(paths.directory, `.current-${process.pid}-${randomUUID()}.json`);
  let unpublished;
  try {
    snapshot = projectSnapshot(projectPath, schemaPath);
    const lockedValue = generation(snapshot.state);
    const lockedCurrent = openCurrent(snapshot.project, snapshot.state, env);
    if (lockedCurrent) {
      lockedCurrent.close();
      return false;
    }
    const { entries } = recordEntries(snapshot.project, { stores: ['all'] });
    buildDatabase(temporary, snapshot.project, entries, snapshot.state, lockedValue);
    const after = sourceState(snapshot.project, snapshot.files);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.state)) {
      fail('INDEX_CHANGED', 'task stores changed while the search index was being refreshed; retry the search');
    }
    chmodSync(temporary, 0o600);
    const name = `index-${lockedValue}.sqlite`;
    renameSync(temporary, join(paths.directory, name));
    unpublished = join(paths.directory, name);
    let previous;
    try {
      const pointerState = JSON.parse(readFileSync(paths.pointer, 'utf8'));
      if (typeof pointerState.database === 'string' && /^index-[a-f0-9]{64}\.sqlite$/.test(pointerState.database)) {
        previous = pointerState.database;
      }
    } catch {}
    writeFileSync(pointer, `${JSON.stringify({ version: indexVersion, generation: lockedValue, database: name })}\n`, { mode: 0o600 });
    renameSync(pointer, paths.pointer);
    unpublished = undefined;
    // Keep the previous published generation for readers that already fetched its pointer.
    try {
      for (const file of readdirSync(paths.directory)) {
        if (file !== name && file !== previous && /^index-[a-f0-9]{64}\.sqlite$/.test(file)) {
          try { unlinkSync(join(paths.directory, file)); } catch {}
        }
      }
    } catch {}
    return true;
  } finally {
    let cleanupError;
    for (const path of [temporary, pointer, unpublished].filter(Boolean)) {
      try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') cleanupError ??= error; }
    }
    try { release(paths.lock, ownedToken); } catch (error) { cleanupError ??= error; }
    if (cleanupError) throw cleanupError;
  }
}

export function scheduleSearchRefresh(projectPath, options = {}) {
  const root = resolve(projectPath);
  const { env = process.env } = options;
  const paths = searchIndexPaths(root, env);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (options.detached) {
    const { schemaPath } = options;
    const snapshot = projectSnapshot(root, schemaPath);
    const value = generation(snapshot.state);
    const current = openCurrent(snapshot.project, snapshot.state, env);
    if (current) {
      current.close();
      return false;
    }
    const lockToken = acquire(paths.lock, value);
    if (!lockToken) return false;
    let child;
    try {
      const worker = fileURLToPath(new URL('./search-index-worker.mjs', import.meta.url));
      child = spawn(process.execPath, [worker, JSON.stringify({ projectPath: root, schemaPath, lockToken })], {
        // A background worker must not retain the project or application directory on Windows.
        cwd: userInfo().homedir, detached: true, stdio: 'ignore', env,
      });
      child.once('error', () => { try { release(paths.lock, lockToken); } catch {} });
      child.unref();
      return true;
    } catch (error) {
      try { release(paths.lock, lockToken); } catch {}
      throw error;
    }
  }
  if (refreshes.has(root)) return false;
  let finish;
  const pending = new Promise((resolvePending) => { finish = resolvePending; });
  refreshes.set(root, pending);
  setImmediate(() => {
    let result;
    try { result = { refreshed: refreshSearchIndex(root, options) }; } catch (error) { result = { error }; }
    finally {
      refreshes.delete(root);
      finish(result);
    }
  });
  return true;
}

export function waitForSearchRefresh(projectPath) {
  return refreshes.get(resolve(projectPath)) ?? Promise.resolve();
}

function likePattern(needle) {
  return `%${needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function indexSelection(project, selectors) {
  const { files, selectedGroup } = selectStoreFiles(project, selectors);
  const statuses = selectedGroup === undefined ? [] : [...project.groups]
    .filter(([, group]) => group === selectedGroup).map(([status]) => status);
  const values = files.length ? [...files, ...(selectedGroup === undefined ? [] : statuses)] : [];
  const selected = (alias = '') => {
    if (!files.length) return '0';
    const prefix = alias ? `${alias}.` : '';
    const clauses = [`${prefix}store IN (${files.map(() => '?').join(', ')})`];
    if (selectedGroup !== undefined) clauses.push(`${prefix}status IN (${statuses.map(() => '?').join(', ')})`);
    return clauses.join(' AND ');
  };
  return { files, values, selected };
}

export function indexedSearch(project, state, selectors, needle, env = process.env) {
  const database = openCurrent(project, state, env);
  if (!database) return undefined;
  try {
    const { files, values: selection, selected } = indexSelection(project, selectors);
    const available = {};
    for (const row of database.prepare(`
      SELECT field FROM (
        SELECT field, first_seq, field_pos,
          ROW_NUMBER() OVER (PARTITION BY field ORDER BY first_seq, field_pos) AS occurrence
        FROM available WHERE ${selected()}
      ) WHERE occurrence = 1 ORDER BY first_seq, field_pos
    `).all(...selection)) {
      available[row.field] = true;
    }
    const total = Number(database.prepare(`SELECT COUNT(*) AS total FROM tasks WHERE ${selected()}`)
      .get(...selection).total);
    const fields = selectors.searchFields.includes('all') ? [] : [...new Set(selectors.searchFields)];
    const fieldWhere = fields.length ? `AND field IN (${fields.map(() => '?').join(', ')})` : '';
    const trigram = [...needle].length >= 3;
    const textWhere = trigram ? "search MATCH ? AND text LIKE ? ESCAPE '\\'" : "text LIKE ? ESCAPE '\\'";
    const textValues = trigram ? [`"${needle.replaceAll('"', '""')}"`, likePattern(needle)] : [likePattern(needle)];
    return {
      available: total ? [available] : [], stores: files, total,
      read(offset, count) {
        if (offset >= total) return [];
        const first = database.prepare(`
          SELECT seq FROM tasks WHERE ${selected()} ORDER BY seq LIMIT 1 OFFSET ?
        `).get(...selection, offset);
        if (!first) return [];
        const records = [];
        const seen = new Set();
        const batch = Math.max(count * 4, 64);
        let hit = 0;
        while (records.length < count) {
          const rows = database.prepare(`
            SELECT search.rowid AS hit, t.seq, t.task
            FROM search JOIN tasks AS t ON t.seq = search.task_row
            WHERE ${textWhere} ${fieldWhere}
              AND ${selected('t')} AND t.seq >= ? AND search.rowid > ?
            ORDER BY search.rowid LIMIT ?
          `).all(
            ...textValues, ...fields, ...selection, first.seq, hit, batch,
          );
          for (const row of rows) {
            if (seen.has(row.seq)) continue;
            seen.add(row.seq);
            records.push({ seq: Number(row.seq), record: JSON.parse(row.task) });
            if (records.length === count) break;
          }
          if (rows.length < batch) break;
          hit = Number(rows.at(-1).hit);
        }
        const countRange = database.prepare(`
          SELECT COUNT(*) AS total FROM tasks
          WHERE ${selected()} AND seq >= ? AND seq < ?
        `);
        let position = offset;
        let previous = Number(first.seq);
        return records.map(({ seq, record }) => {
          position += Number(countRange.get(...selection, previous, seq).total);
          const candidate = { index: position, record };
          previous = seq;
          return candidate;
        });
      },
      close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function indexedTasks(project, state, selectors, ids, env = process.env) {
  const database = openCurrent(project, state, env);
  if (!database) return undefined;
  try {
    const { files, values, selected } = indexSelection(project, selectors);
    const found = new Map();
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const rows = database.prepare(`
        SELECT id, task FROM tasks
        WHERE ${selected()} AND id IN (${batch.map(() => '?').join(', ')})
      `).all(...values, ...batch);
      for (const row of rows) found.set(Number(row.id), JSON.parse(row.task));
    }
    return { records: ids.flatMap((id) => found.has(id) ? [found.get(id)] : []), stores: files };
  } finally {
    database.close();
  }
}

function decodedValue(kind, value) {
  if (kind === 'null') return null;
  if (kind === 'number') return Number(value);
  if (kind === 'boolean') return value === 'true';
  if (kind === 'array' || kind === 'object') return JSON.parse(value);
  return value;
}

function valueMatches(kind, value, expected) {
  function matches(actual) {
    if (actual === undefined || actual === null) return false;
    if (Array.isArray(actual)) return actual.some(matches);
    if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected;
    const text = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
    return text.toLowerCase().includes(expected.toLowerCase());
  }
  return matches(decodedValue(kind, value)) ? 1 : 0;
}

function fieldValue(task, field) {
  const record = JSON.parse(task);
  if (!Object.hasOwn(record, field)) return null;
  const value = record[field];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const encoded = ['array', 'object'].includes(kind) ? JSON.stringify(value) : String(value ?? '');
  return JSON.stringify([kind, encoded]);
}

function fieldMatches(task, field, expected) {
  const encoded = fieldValue(task, field);
  if (encoded === null) return 0;
  return valueMatches(...JSON.parse(encoded), expected);
}

function sortValue(task, field) {
  const value = JSON.parse(task)[field];
  if (value === undefined || value === null) return null;
  return typeof value === 'number' ? value : textKey(typeof value === 'object' ? JSON.stringify(value) : String(value));
}

export function indexedList(project, state, selectors, query, env = process.env) {
  const database = openCurrent(project, state, env);
  if (!database) return undefined;
  try {
    database.function('task_field_matches', { deterministic: true }, fieldMatches);
    database.function('task_sort_value', { deterministic: true }, sortValue);
    const { files, values: selection, selected } = indexSelection(project, selectors);
    const total = Number(database.prepare(`SELECT COUNT(*) AS total FROM tasks WHERE ${selected()}`)
      .get(...selection).total);
    const available = database.prepare(`
      SELECT field FROM (
        SELECT field, first_seq, field_pos,
          ROW_NUMBER() OVER (PARTITION BY field ORDER BY first_seq, field_pos) AS occurrence
        FROM available WHERE ${selected()}
      ) WHERE occurrence = 1 ORDER BY first_seq, field_pos
    `).all(...selection).map((row) => row.field);
    const clauses = [selected('t')];
    const values = [...selection];
    if (query.ids.length) {
      clauses.push(`t.id IN (${query.ids.map(() => '?').join(', ')})`);
      values.push(...query.ids);
    }
    for (const filter of query.filters) {
      if (filter.field === 'status') {
        clauses.push('t.status = ?');
        values.push(filter.value);
      } else {
        clauses.push('task_field_matches(t.task, ?, ?) = 1');
        values.push(filter.field, filter.value);
      }
    }
    if (!['id', 'title', 'priority'].includes(query.sort)) {
      const kinds = database.prepare(`
        SELECT DISTINCT kind FROM sort_types WHERE ${selected()} AND field = ? LIMIT 2
      `).all(...selection, query.sort);
      if (kinds.length > 1) {
        database.close();
        return { mixedSort: true };
      }
    }
    const where = clauses.join(' AND ');
    const count = Number(database.prepare(`SELECT COUNT(*) AS total FROM tasks AS t WHERE ${where}`)
      .get(...values).total);
    return {
      available, count, stores: files, sourceTotal: total,
      records(offset, limit, descending) {
        const direction = descending ? 'DESC' : 'ASC';
        if (['id', 'title', 'priority'].includes(query.sort)) {
          const column = query.sort === 'id' ? 'id' : query.sort === 'title' ? 'title_key' : 'priority_rank';
          return database.prepare(`
            SELECT t.task FROM tasks AS t WHERE ${where}
            ORDER BY t.${column} ${direction}${column === 'id' ? '' : ', t.id ASC'} LIMIT ? OFFSET ?
          `).all(...values, limit, offset).map((row) => JSON.parse(row.task));
        }
        const sort = 'task_sort_value(t.task, ?)';
        const sortValues = [query.sort];
        return database.prepare(`
          SELECT t.task FROM tasks AS t WHERE ${where}
          ORDER BY (${sort}) IS NULL ${direction}, ${sort} ${direction}, t.id ASC LIMIT ? OFFSET ?
        `).all(...values, ...sortValues, ...sortValues, limit, offset).map((row) => JSON.parse(row.task));
      },
      close() { database.close(); },
    };
  } catch {
    database.close();
    return undefined;
  }
}

export function indexedTask(project, state, selectors, id, env = process.env) {
  const database = openCurrent(project, state, env);
  if (!database) return undefined;
  try {
    const { files, values, selected } = indexSelection(project, selectors);
    const row = database.prepare(`SELECT task FROM tasks WHERE ${selected()} AND id = ?`).get(...values, id);
    return { task: row ? JSON.parse(row.task) : null, stores: files };
  } catch {
    return undefined;
  } finally {
    database.close();
  }
}

export function indexedBlockers(project, state, env = process.env) {
  const database = openCurrent(project, state, env);
  if (!database) return undefined;
  try {
    const { values, selected } = indexSelection(project, { group: 'Active' });
    const find = database.prepare(`SELECT t.task FROM tasks AS t WHERE ${selected('t')} AND t.id = ?`);
    const exists = database.prepare(`SELECT 1 FROM tasks AS t WHERE ${selected('t')} AND t.id = ?`);
    return {
      get(id) {
        const row = find.get(...values, id);
        if (!row) return undefined;
        const task = JSON.parse(row.task);
        return { id, ...(Object.hasOwn(task, 'blockers') ? { blockers: task.blockers } : {}) };
      },
      has(id) { return !!exists.get(...values, id); },
      close() { database.close(); },
    };
  } catch {
    database.close();
    return undefined;
  }
}

export function searchSourceState(project) {
  const { files } = selectStoreFiles(project, { stores: ['all'] });
  return sourceState(project, files);
}
