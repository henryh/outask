import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs, {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { defaultSlowQueryMs, readConfig } from '../src/config.mjs';
import { projectBytes } from '../src/limits.mjs';
import { searchTasks } from '../src/search.mjs';
import {
  refreshSearchIndex, scheduleSearchRefresh, searchIndexPaths, waitForSearchRefresh,
} from '../src/search-index.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));

function cli(args, extra = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 10000, ...extra });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function isolatedCache(context) {
  const cache = mkdtempSync(join(tmpdir(), 'task-tracker-index-test-'));
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  context.after(() => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    rmSync(cache, { recursive: true, force: true });
  });
  return cache;
}

async function waitUntil(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('condition was not met before timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function refreshProcess(root, pauseAfterClaim = false) {
  const module = new URL('../src/search-index.mjs', import.meta.url).href;
  const sqliteModule = new URL('../src/sqlite.mjs', import.meta.url).href;
  const barrier = pauseAfterClaim ? `
    import { readSync } from 'node:fs';
    import { databaseSync } from ${JSON.stringify(sqliteModule)};
    const DatabaseSync = databaseSync();
    const exec = DatabaseSync.prototype.exec;
    let claimed = false;
    DatabaseSync.prototype.exec = function(sql) {
      const result = exec.call(this, sql);
      if (sql === 'COMMIT' && !claimed) {
        claimed = true;
        process.send('claimed');
        if (readSync(0, Buffer.alloc(1), 0, 1, null) !== 1) throw new Error('claim was not released');
      }
      return result;
    };
  ` : '';
  const source = `import { refreshSearchIndex } from ${JSON.stringify(module)};\n`
    + barrier + `process.stdout.write(String(refreshSearchIndex(${JSON.stringify(root)})));\n`
    + `if (process.connected) process.disconnect();\n`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: process.env, stdio: pauseAfterClaim ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    timeout: 10000, killSignal: 'SIGKILL',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = once(child, 'close');
  return {
    child, closed,
    async outcome() {
      const [code] = await closed;
      assert.equal(code, 0, stderr);
      return stdout;
    },
  };
}

function seedLock(path, { token, pid, startedMs }) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS refresh_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL,
      pid INTEGER NOT NULL, generation TEXT NOT NULL, started_ms INTEGER NOT NULL
    ) STRICT;
    DELETE FROM refresh_lock;
  `);
  database.prepare('INSERT INTO refresh_lock VALUES (1, ?, ?, ?, ?)')
    .run(token, pid, 'test-generation', startedMs);
  database.close();
}

test('search matches literal text case-insensitively across scalar values but not object keys', (context) => {
  const root = fixture(context, [
    task(1, { title: 'Unicode NÉEDLE', notes: { hiddenNeedle: 'plain value' } }),
    task(2, { scope: ['first', { detail: 'nested néedle value' }] }),
    task(3, { acceptance: ['Use .* literally'], notes: { count: 42, ready: true } }),
  ]);
  const before = snapshot(root);
  const page = searchTasks(root, 'néedle');
  assert.deepEqual(page.tasks.map((row) => row.id), [1, 2]);
  assert.deepEqual(page.tasks[0].matched_fields, ['title']);
  assert.equal(page.tasks[1].snippets.scope, 'nested néedle value');
  assert.equal(searchTasks(root, 'hiddenneedle').tasks.length, 0);
  assert.deepEqual(searchTasks(root, '.*').tasks.map((row) => row.id), [3]);
  assert.deepEqual(searchTasks(root, '42', { searchFields: ['notes'] }).tasks.map((row) => row.id), [3]);
  assert.deepEqual(searchTasks(root, 'true', { searchFields: ['notes'] }).tasks.map((row) => row.id), [3]);
  assert.equal(searchTasks(root, 'absent', { searchFields: ['field_not_present'] }).tasks.length, 0);
  assert.deepEqual(snapshot(root), before);
});

test('search cursor continues a bounded page and is bound to query and selectors', (context) => {
  const root = fixture(context, Array.from({ length: 4 }, (_, index) => task(index + 1, {
    scope: `shared match ${index + 1}`,
  })));
  writeStore(root, 'done.json', [task(99, { status: 'done', scope: 'shared match done', completed_at: '2026-09-17T00:00:00Z' })]);
  const first = searchTasks(root, 'SHARED', { limit: 2, fields: ['id', 'scope'] });
  assert.deepEqual(first.tasks.map((row) => row.id), [1, 2]);
  assert.equal(first.hasMore, true);
  assert.match(first.next_cursor, /^[A-Za-z0-9_-]+$/);
  const second = searchTasks(root, 'SHARED', { limit: 2, fields: ['id', 'scope'], cursor: first.next_cursor });
  assert.deepEqual(second.tasks.map((row) => row.id), [3, 4]);
  assert.equal(second.hasMore, false);
  assert.equal(second.next_cursor, null);
  for (const request of [
    () => searchTasks(root, 'different', { limit: 2, fields: ['id', 'scope'], cursor: first.next_cursor }),
    () => searchTasks(root, 'SHARED', { limit: 2, fields: ['id'], cursor: first.next_cursor }),
    () => searchTasks(root, 'SHARED', { limit: 2, fields: ['id', 'scope'], searchFields: ['title'], cursor: first.next_cursor }),
    () => searchTasks(root, 'SHARED', { limit: 2, fields: ['id', 'scope'], group: 'Done', cursor: first.next_cursor }),
    () => searchTasks(root, 'SHARED', { cursor: 'not-a-cursor' }),
  ]) assert.throws(request, { code: 'INVALID_CURSOR' });
});

test('search reuses group and store selection and bounds every successful JSON page', (context) => {
  const root = fixture(context, [task(1, { scope: 'find me', details: 'x'.repeat(40_000) })]);
  writeStore(root, 'done.json', [task(9, { status: 'done', scope: 'find me', completed_at: '2026-09-17T00:00:00Z' })]);
  assert.deepEqual(searchTasks(root, 'find').tasks.map((row) => row.id), [1]);
  assert.deepEqual(searchTasks(root, 'find', { group: 'Done' }).tasks.map((row) => row.id), [9]);
  assert.deepEqual(searchTasks(root, 'find', { stores: ['all'] }).tasks.map((row) => row.id), [1, 9]);
  assert.throws(() => searchTasks(root, 'find', { stores: ['active'], group: 'Active' }), { code: 'INVALID_INPUT' });
  const bounded = searchTasks(root, 'find', { fields: ['id'] });
  assert.ok(Buffer.byteLength(`${JSON.stringify(bounded, null, 2)}\n`, 'utf8') <= 32 * 1024);
  assert.throws(() => searchTasks(root, 'find', { fields: ['all'] }), (error) => {
    assert.equal(error.code, 'OUTPUT_TOO_LARGE');
    assert.match(error.message, /select fewer --fields/);
    return true;
  });
});

test('search modes default to scan while auto and indexed fall back and refresh', async (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { scope: 'find me' })]);
  assert.equal(defaultSlowQueryMs, 150);
  assert.deepEqual(searchTasks(root, 'find').tasks.map((row) => row.id), [1]);

  const automatic = fixture(context, [task(1, { scope: 'find me' })], {
    stores: { 'active.json': { statuses: ['pending'] } },
    search: { mode: 'auto' },
  });
  const page = searchTasks(automatic, 'find', { slowQueryMs: 0 });
  assert.equal(page.tasks[0].id, 1);
  assert.equal(page.advisories[0].code, 'SLOW_SCAN');
  assert.ok(page.advisories[0].elapsed_ms > 0);
  assert.match(page.advisories[0].message, /refreshes in the background/);
  await waitForSearchRefresh(automatic);
  assert.equal(Object.hasOwn(searchTasks(automatic, 'find', { slowQueryMs: 0 }), 'advisories'), false);

  const indexed = fixture(context, [task(1)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const advisories = [];
  assert.deepEqual(searchTasks(indexed, 'task', { onAdvisory: (item) => advisories.push(item) }).tasks.map(({ id }) => id), [1]);
  assert.equal(advisories[0].code, 'CACHE_FALLBACK');
  const standalone = run('search-tasks', [indexed, 'task', '--format', 'json']);
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.deepEqual(JSON.parse(standalone.stdout).tasks.map(({ id }) => id), [1]);
  const installed = cli(['search', 'task', '--format', 'json'], { cwd: indexed });
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(installed.stdout).tasks.map(({ id }) => id), [1]);
});

test('indexed search reports an unusable cache root without claiming a refresh', (context) => {
  const root = fixture(context, [task(1, { scope: 'JSON result' })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const blocked = join(root, 'cache-root');
  writeFileSync(blocked, 'not a directory');
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = blocked;
  const advisories = [];
  let page;
  try {
    page = searchTasks(root, 'result', { slowQueryMs: 0, onAdvisory: (item) => advisories.push(item) });
  } finally {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
  }
  assert.deepEqual(page.tasks.map(({ id }) => id), [1]);
  assert.deepEqual(advisories, [{
    code: 'CACHE_UNAVAILABLE', message: 'SQLite cache acceleration is unavailable; authoritative JSON was used.',
  }]);
  assert.equal(page.advisories[0].code, 'SLOW_SCAN');
  assert.match(page.advisories[0].message, /cache acceleration was unavailable/);
  assert.doesNotMatch(page.advisories[0].message, /refresh/i);

  const command = run('search-tasks', [root, 'result', '--format', 'json'], {
    env: { ...process.env, XDG_CACHE_HOME: blocked },
  });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout).tasks.map(({ id }) => id), [1]);
  assert.equal(command.stderr, 'Advisory CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable; authoritative JSON was used.\n');
  assert.equal(readFileSync(blocked, 'utf8'), 'not a directory');
});

test('slow scan advisories respect threshold boundaries and the response budget', (context) => {
  const quiet = fixture(context, [task(1, { scope: 'find me' })], {
    stores: { 'active.json': { statuses: ['pending'] } },
  });
  assert.equal(Object.hasOwn(searchTasks(quiet, 'find', { slowQueryMs: Number.MAX_SAFE_INTEGER }), 'advisories'), false);

  const warned = fixture(context, [task(1, { scope: 'find me', details: 'x'.repeat(40_000) })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'scan' },
  });
  const registry = join(warned, 'registry.json');
  writeFileSync(registry, JSON.stringify({ slow_query_ms: 0 }));
  const page = searchTasks(warned, 'find', { fields: ['id'], slowQueryMs: 0 });
  assert.equal(page.advisories.length, 1);
  assert.ok(Buffer.byteLength(`${JSON.stringify(page, null, 2)}\n`, 'utf8') <= 32 * 1024);
  const env = { ...process.env, TASK_TRACKER_CONFIG: registry };
  const output = success(run('search-tasks', [warned, 'find', '--fields', 'id', '--format', 'json'], { env }));
  assert.equal(JSON.parse(output.stdout).advisories[0].code, 'SLOW_SCAN');
  const human = success(cli(['search', 'find', '--fields', 'id', '--config', registry], { cwd: warned }));
  assert.match(human.stderr, /Advisory SLOW_SCAN:.*search\.mode to auto.* ms/);
});

test('indexed search preserves substring, field, snippet, selection and cursor behaviour', (context) => {
  isolatedCache(context);
  const root = fixture(context, [
    task(1, { title: 'Unicode NÉEDLE', scope: 'shared first' }),
    task(2, { title: 'Second task', scope: ['shared nested néedle', 'another shared value'] }),
    task(3, { scope: 'shared final', details: 'x'.repeat(40_000) }),
    task(4, { title: 'literal %_" marker' }),
  ], { stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } }, search: { mode: 'indexed' } });
  writeStore(root, 'done.json', [task(9, { status: 'done', scope: 'shared history', completed_at: '2026-09-17T00:00:00Z' })]);
  assert.equal(refreshSearchIndex(root), true);
  const unicode = searchTasks(root, 'néed', { fields: ['id', 'title'], searchFields: ['title', 'scope'] });
  assert.deepEqual(unicode.tasks.map((row) => row.id), [1, 2]);
  assert.deepEqual(unicode.tasks[1].matched_fields, ['scope']);
  assert.equal(unicode.tasks[1].snippets.scope, 'shared nested néedle');
  assert.deepEqual(searchTasks(root, 'shared', { searchFields: ['title'] }).tasks, []);
  const first = searchTasks(root, 'shared', { limit: 2, fields: ['id', 'scope'] });
  assert.deepEqual(first.tasks.map((row) => row.id), [1, 2]);
  assert.deepEqual(searchTasks(root, 'shared', {
    limit: 2, fields: ['id', 'scope'], cursor: first.next_cursor,
  }).tasks.map((row) => row.id), [3]);
  assert.deepEqual(searchTasks(root, 'shared', { group: 'Done' }).tasks.map((row) => row.id), [9]);
  assert.deepEqual(searchTasks(root, '%_"', { searchFields: ['title'], fields: ['id'] }).tasks.map((row) => row.id), [4]);
  assert.throws(() => searchTasks(root, 'shared final', { fields: ['all'] }), { code: 'OUTPUT_TOO_LARGE' });
});

test('auto search detects changed sources, serves a scan and refreshes one generation', async (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { scope: 'old phrase' })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'auto' },
  });
  const before = snapshot(root);
  searchTasks(root, 'old');
  const refresh = await waitForSearchRefresh(root);
  assert.ifError(refresh.error);
  assert.equal(Object.hasOwn(searchTasks(root, 'old', { slowQueryMs: 0 }), 'advisories'), false);
  writeStore(root, 'active.json', [task(1, { scope: 'new phrase' })]);
  const changed = searchTasks(root, 'new', { slowQueryMs: 0 });
  assert.deepEqual(changed.tasks.map((row) => row.id), [1]);
  assert.equal(changed.advisories[0].code, 'SLOW_SCAN');
  assert.equal(scheduleSearchRefresh(root), false);
  await waitForSearchRefresh(root);
  assert.equal(Object.hasOwn(searchTasks(root, 'new', { slowQueryMs: 0 }), 'advisories'), false);
  assert.deepEqual(Object.keys(snapshot(root)), Object.keys(before));
});

test('large auto search returns before its background index build completes', async (context) => {
  isolatedCache(context);
  const root = fixture(context, Array.from({ length: 6000 }, (_, index) => task(index + 100, {
    scope: index === 5999 ? 'large fixture needle' : `ordinary record ${index}`,
  })), { stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'auto' } });
  const started = performance.now();
  const page = searchTasks(root, 'large fixture needle', { slowQueryMs: Number.MAX_SAFE_INTEGER });
  const elapsed = performance.now() - started;
  assert.deepEqual(page.tasks.map((row) => row.id), [6099]);
  assert.ok(elapsed < 2000, `foreground search took ${elapsed} ms`);
  assert.equal(existsSync(searchIndexPaths(root).pointer), false);
  const refresh = await waitForSearchRefresh(root);
  assert.ifError(refresh.error);
  assert.equal(existsSync(searchIndexPaths(root).pointer), true);
  assert.equal(Object.hasOwn(searchTasks(root, 'large fixture needle', { slowQueryMs: 0 }), 'advisories'), false);
});

test('standalone auto search exits while a detached refresh continues', async (context) => {
  isolatedCache(context);
  const root = fixture(context, Array.from({ length: 3000 }, (_, index) => task(index + 100, {
    scope: index === 2999 ? 'detached refresh needle' : `detached record ${index}`,
  })), { stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'auto' } });
  const started = performance.now();
  const result = success(run('search-tasks', [root, 'detached refresh needle', '--format', 'json']));
  const elapsed = performance.now() - started;
  assert.deepEqual(JSON.parse(result.stdout).tasks.map((row) => row.id), [3099]);
  assert.ok(elapsed < 2000, `standalone foreground search took ${elapsed} ms`);
  await waitUntil(() => existsSync(searchIndexPaths(root).pointer));
  const indexed = success(run('search-tasks', [root, 'detached refresh needle', '--format', 'json']));
  assert.doesNotMatch(indexed.stderr, /ExperimentalWarning/);
  assert.equal(Object.hasOwn(JSON.parse(indexed.stdout), 'advisories'), false);
});

test('refresh records fingerprints outside Git and recovers from stale locks, failures and corruption', (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { scope: 'indexed value' })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const paths = searchIndexPaths(root);
  mkdirSync(paths.directory, { recursive: true });
  seedLock(paths.lock, { token: 'stale', pid: 99999999, startedMs: Date.now() - 60_000 });
  assert.equal(refreshSearchIndex(root), true);
  assert.equal(existsSync(paths.pointer), true);
  assert.equal(paths.pointer.startsWith(root), false);
  const original = readFileSync(paths.pointer, 'utf8');
  truncateSync(join(root, 'tasks/active.json'), projectBytes + 1);
  assert.throws(() => refreshSearchIndex(root), { code: 'INPUT_TOO_LARGE' });
  assert.equal(readFileSync(paths.pointer, 'utf8'), original);
  writeFileSync(join(root, 'tasks/active.json'), '{ invalid json');
  assert.throws(() => refreshSearchIndex(root), { code: 'INVALID_JSON' });
  assert.equal(readFileSync(paths.pointer, 'utf8'), original);
  writeStore(root, 'active.json', [task(1, { scope: 'recovered value' })]);
  assert.equal(refreshSearchIndex(root), true);
  const current = JSON.parse(readFileSync(paths.pointer, 'utf8'));
  const database = join(paths.directory, current.database);
  const opened = new DatabaseSync(database, { readOnly: true });
  const sources = JSON.parse(opened.prepare('SELECT value FROM meta WHERE key = ?').get('sources').value);
  opened.close();
  assert.ok(sources.stores['active.json'].mtime_ns);
  writeFileSync(database, 'corrupt');
  assert.deepEqual(searchTasks(root, 'recovered').tasks.map((row) => row.id), [1]);
  assert.equal(refreshSearchIndex(root), true);
  assert.deepEqual(searchTasks(root, 'recovered').tasks.map((row) => row.id), [1]);
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' }, format: 'standard',
  }));
  assert.deepEqual(searchTasks(root, 'recovered').tasks.map((row) => row.id), [1]);
  assert.equal(refreshSearchIndex(root), true);
  assert.deepEqual(searchTasks(root, 'recovered').tasks.map((row) => row.id), [1]);
  unlinkSync(join(root, 'tasks/active.json'));
  assert.throws(() => searchTasks(root, 'recovered'), { code: 'READ_ERROR' });
  writeStore(root, 'active.json', [task(1, { scope: 'recovered value' })]);
  assert.equal(refreshSearchIndex(root), true);
});

test('refresh rejects a store edit while lazy index entries are consumed', (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { scope: 'published generation' })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  assert.equal(refreshSearchIndex(root), true);
  const pointer = searchIndexPaths(root).pointer;
  const published = readFileSync(pointer);
  writeStore(root, 'active.json', [task(1, { scope: 'build candidate' })]);
  const open = fs.openSync;
  const read = fs.readSync;
  const active = new Set();
  let raced = false;
  context.mock.method(fs, 'openSync', (...args) => {
    const descriptor = open(...args);
    if (String(args[0]).endsWith('/tasks/active.json')) active.add(descriptor);
    return descriptor;
  });
  context.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    if (!raced && count === 0 && active.has(args[0])) {
      raced = true;
      writeStore(root, 'active.json', [task(1, { scope: 'raced source' })]);
    }
    return count;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => refreshSearchIndex(root), { code: 'INDEX_CHANGED' });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(raced, true);
  assert.deepEqual(readFileSync(pointer), published);
  assert.deepEqual(searchTasks(root, 'raced source').tasks.map((row) => row.id), [1]);
});

test('multiprocess refresh reclaims one stale lock without deleting a live owner', async (context) => {
  isolatedCache(context);
  const root = fixture(context, Array.from({ length: 500 }, (_, index) => task(index + 100, {
    scope: `contended record ${index}`,
  })), { stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' } });
  const paths = searchIndexPaths(root);
  mkdirSync(paths.directory, { recursive: true });
  seedLock(paths.lock, { token: 'stale', pid: 99999999, startedMs: Date.now() - 60_000 });
  const owner = refreshProcess(root, true);
  let contender;
  try {
    // Hold the committed owner row while the rival attempts its nonblocking refresh.
    const [message] = await once(owner.child, 'message', { signal: AbortSignal.timeout(10000) });
    assert.equal(message, 'claimed');
    const readOwner = () => {
      const database = new DatabaseSync(paths.lock);
      try { return database.prepare('SELECT token, pid FROM refresh_lock WHERE id = 1').get(); }
      finally { database.close(); }
    };
    const claimed = readOwner();
    assert.equal(claimed.pid, owner.child.pid);
    assert.notEqual(claimed.token, 'stale');
    contender = refreshProcess(root);
    const lost = await contender.outcome();
    assert.equal(lost, 'false', 'the contender must not refresh while the owner is live');
    assert.deepEqual(readOwner(), claimed);
    owner.child.stdin.end(Buffer.from([1]));
    const won = await owner.outcome();
    assert.equal(won, 'true', 'the lock owner must complete its refresh after release');
    const outcomes = [lost, won];
    assert.deepEqual(outcomes.sort(), ['false', 'true']);
  } finally {
    for (const worker of [owner, contender].filter(Boolean)) {
      worker.child.stdin?.destroy();
      worker.child.kill('SIGKILL');
      await worker.closed;
    }
  }
  assert.deepEqual(searchTasks(root, 'contended record 499').tasks.map((row) => row.id), [599]);
  writeStore(root, 'active.json', [task(700, { scope: 'retry after interrupted worker' })]);
  const worker = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  seedLock(paths.lock, { token: 'live-worker', pid: worker.pid, startedMs: Date.now() - 60_000 });
  assert.equal(refreshSearchIndex(root), false);
  worker.kill('SIGTERM');
  await once(worker, 'close');
  assert.equal(refreshSearchIndex(root), true);
  assert.deepEqual(searchTasks(root, 'interrupted worker').tasks.map((row) => row.id), [700]);
  writeStore(root, 'active.json', [task(800, { scope: 'late worker claim is rejected' })]);
  seedLock(paths.lock, { token: 'old-worker', pid: 99999999, startedMs: Date.now() - 60_000 });
  assert.equal(refreshSearchIndex(root), true);
  assert.equal(refreshSearchIndex(root, { lockClaimed: true, lockToken: 'old-worker' }), false);
  assert.deepEqual(searchTasks(root, 'late worker').tasks.map((row) => row.id), [800]);
  writeStore(root, 'active.json', [task(900, { scope: 'transaction crash recovery' })]);
  const transaction = `
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(${JSON.stringify(paths.lock)});
    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO refresh_lock VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token=excluded.token, pid=excluded.pid, generation=excluded.generation, started_ms=excluded.started_ms')
      .run('interrupted-transaction', process.pid, 'test', Date.now());
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `;
  const interrupted = spawn(process.execPath, ['--eval', transaction], { stdio: ['ignore', 'pipe', 'ignore'] });
  await once(interrupted.stdout, 'data');
  assert.equal(refreshSearchIndex(root), false);
  interrupted.kill('SIGKILL');
  await once(interrupted, 'close');
  assert.equal(refreshSearchIndex(root), true);
  assert.deepEqual(searchTasks(root, 'crash recovery').tasks.map((row) => row.id), [900]);
});

test('invalid search settings use the shared configuration error path', (context) => {
  const cases = [null, { mode: 'unknown' }, { slow_query_ms: 1 }, { extra: true }];
  for (const search of cases) {
    const root = fixture(context, [task(1)], {
      stores: { 'active.json': { statuses: ['pending'] } }, search,
    });
    assert.throws(() => searchTasks(root, 'task'), { code: 'INVALID_CONFIG' });
    const standalone = run('search-tasks', [root, 'task']);
    assert.equal(standalone.status, 1);
    assert.match(standalone.stderr, /^INVALID_CONFIG:/);
    const installed = cli(['search', 'task'], { cwd: root });
    assert.equal(installed.status, 1);
    assert.match(installed.stderr, /^INVALID_CONFIG:/);
  }
  for (const slowQueryMs of [-1, 1.5]) {
    const root = fixture(context, [task(1)]);
    const registry = join(root, 'registry.json');
    writeFileSync(registry, JSON.stringify({ slow_query_ms: slowQueryMs }));
    assert.throws(() => readConfig(registry), { code: 'INVALID_CONFIG' });
    const env = { ...process.env, TASK_TRACKER_CONFIG: registry };
    const standalone = run('search-tasks', [root, 'task'], { env });
    assert.equal(standalone.status, 1);
    assert.match(standalone.stderr, /^INVALID_CONFIG:.*slow_query_ms/);
    const installed = cli(['search', 'task', '--config', registry], { cwd: root });
    assert.equal(installed.status, 1);
    assert.match(installed.stderr, /^INVALID_CONFIG:.*slow_query_ms/);
  }
  assert.throws(() => searchTasks(fixture(context, [task(1)]), 'task', { slowQueryMs: -1 }), { code: 'INVALID_INPUT' });
});

test('standalone and installed search support project selection, metadata and continuation', (context) => {
  const root = fixture(context, Array.from({ length: 3 }, (_, index) => task(index + 1, {
    scope: `remembered phrase ${index + 1}`,
  })));
  const standalone = success(run('search-tasks', [root, 'remembered', '--limit', '1', '--format', 'json']));
  const first = JSON.parse(standalone.stdout);
  assert.deepEqual(first.tasks[0].matched_fields, ['scope']);
  assert.equal(first.hasMore, true);
  assert.ok(first.next_cursor);
  const current = success(cli(['search', 'remembered', '--limit', '1', '--format', 'ids'], { cwd: root }));
  assert.equal(current.stdout, '1\n');
  assert.match(current.stderr, /Next page: tasks search --cursor/);
  const explicit = success(cli(['search', 'remembered', '--project-path', root, '--format', 'ids']));
  assert.equal(explicit.stdout, '1 2 3\n');
  const registry = join(root, 'registry', 'config.json');
  mkdirSync(dirname(registry), { recursive: true });
  writeFileSync(registry, JSON.stringify({ projects: { selected: root } }));
  const named = success(cli(['search', 'remembered', '--project', 'selected', '--config', registry, '--format', 'ids']));
  assert.equal(named.stdout, '1 2 3\n');
  const defaultOutput = success(cli(['search', 'remembered'], { cwd: root }));
  assert.match(defaultOutput.stdout, /^id\s+title\s+status\s+matched_fields\s+snippets\n/);
  const continued = success(cli(['search', 'remembered', '--limit', '1', '--cursor', first.next_cursor, '--format', 'json'], { cwd: root }));
  assert.deepEqual(JSON.parse(continued.stdout).tasks.map((row) => row.id), [2]);
});

test('search validates query, fields, pagination and cursor input', (context) => {
  const root = fixture(context, [task(1)]);
  for (const request of [
    () => searchTasks(root, ''),
    () => searchTasks(root, 'task', null),
    () => searchTasks(root, 'task', { limit: 0 }),
    () => searchTasks(root, 'task', { fields: [] }),
    () => searchTasks(root, 'task', { searchFields: [] }),
  ]) assert.throws(request, { code: 'INVALID_INPUT' });
  const result = run('search-tasks', [root, 'task', '--search-fields=']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^INVALID_INPUT:/);
});
