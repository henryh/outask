import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectBlockers } from '../src/blockers.mjs';
import { databaseSync } from '../src/sqlite.mjs';
import { searchTasks } from '../src/search.mjs';
import {
  refreshSearchIndex, searchIndexPaths, waitForSearchRefresh,
} from '../src/search-index.mjs';
import { countTasks, getTask, getTasks, listTasks } from '../src/tasks.mjs';
import { updateTask } from '../src/update.mjs';
import { fixture, run, task, writeStore } from './fixtures.mjs';

function isolatedCache(context) {
  const cache = mkdtempSync(join(tmpdir(), 'task-tracker-replica-test-'));
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  context.after(() => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    rmSync(cache, { recursive: true, force: true });
  });
  return cache;
}

function rejectStoreReads(context, root) {
  const original = fs.openSync;
  context.mock.method(fs, 'openSync', (path, ...args) => {
    if ([join(root, 'tasks/active.json'), join(root, 'tasks/done.json')].includes(String(path))) {
      throw Object.assign(new Error('authoritative store was read'), { code: 'TEST_STORE_READ' });
    }
    return original(path, ...args);
  });
  syncBuiltinESMExports();
}

test('current replica preserves detail, list, filters, sorting, selection and blocker results', (context) => {
  isolatedCache(context);
  const root = fixture(context, [
    task(3, { priority: 'low', blockers: [2], custom: { text: 'Needle' } }),
    task(1, { priority: 'high' }), task(2, { priority: 'medium' }),
  ]);
  const expected = {
    detail: getTask(root, 3, { fields: ['id', 'custom'] }),
    list: listTasks(root, { fields: ['id'], filters: [{ field: 'custom', value: 'needle' }] }),
    sorted: listTasks(root, { fields: ['id'], sort: 'priority', descending: true }),
    history: listTasks(root, { stores: ['all'], fields: ['id'], sort: 'id' }),
    count: countTasks(root, { filters: [{ field: 'custom', value: 'needle' }] }),
    blockers: inspectBlockers(root, 3, { depth: 2 }),
  };
  assert.equal(refreshSearchIndex(root), true);
  rejectStoreReads(context, root);
  try {
    assert.deepEqual(getTask(root, 3, { fields: ['id', 'custom'] }), expected.detail);
    assert.deepEqual(listTasks(root, { fields: ['id'], filters: [{ field: 'custom', value: 'needle' }] }), expected.list);
    assert.deepEqual(listTasks(root, { fields: ['id'], sort: 'priority', descending: true }), expected.sorted);
    assert.deepEqual(listTasks(root, { stores: ['all'], fields: ['id'], sort: 'id' }), expected.history);
    assert.equal(countTasks(root, { filters: [{ field: 'custom', value: 'needle' }] }), expected.count);
    assert.deepEqual(inspectBlockers(root, 3, { depth: 2 }), expected.blockers);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(JSON.parse(run('get-task', [root, '3', '--fields', 'id,custom', '--format', 'json']).stdout), expected.detail);
  assert.deepEqual(JSON.parse(run('list-tasks', [root, '--where', 'custom=needle', '--fields', 'id', '--format', 'json']).stdout), expected.list);
  assert.deepEqual(JSON.parse(run('inspect-blockers', [root, '3', '--depth', '2', '--format', 'json']).stdout), expected.blockers);
  assert.equal(run('list-tasks', [root, '--where', 'custom=needle', '--count']).stdout, `${expected.count}\n`);
});

test('current replica pages a large filtered numeric sort without changing order or totals', (context) => {
  isolatedCache(context);
  const root = fixture(context, Array.from({ length: 1200 }, (_, index) => task(index + 2000, {
    rank: 1200 - index, category: index % 2 ? 'selected' : 'other',
  })));
  const query = {
    filters: [{ field: 'category', value: 'selected' }],
    sort: 'rank', descending: true, offset: 421, limit: 17, fields: ['id', 'rank'],
  };
  const expected = listTasks(root, { ...query, noCache: true });
  const titles = listTasks(root, { fields: ['id'], sort: 'title', descending: true, offset: 421, limit: 17, noCache: true });
  assert.equal(refreshSearchIndex(root), true);
  rejectStoreReads(context, root);
  try {
    assert.deepEqual(listTasks(root, query), expected);
    assert.deepEqual(listTasks(root, { fields: ['id'], sort: 'title', descending: true, offset: 421, limit: 17 }), titles);
    assert.equal(countTasks(root, query), 600);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('cached title sorting follows UTF-16 order for non-BMP characters', (context) => {
  isolatedCache(context);
  const root = fixture(context, [
    task(1, { title: '\uE000 private use', custom: '\uE000' }),
    task(2, { title: '\u{10000} astral', custom: '\u{10000}' }),
  ]);
  const options = { sort: 'title', fields: ['id'] };
  const expected = listTasks(root, { ...options, noCache: true });
  assert.deepEqual(expected.tasks.map((row) => row.id), [2, 1]);
  assert.equal(refreshSearchIndex(root), true);
  assert.deepEqual(listTasks(root, options), expected);
  assert.deepEqual(listTasks(root, { sort: 'custom', fields: ['id'] }),
    listTasks(root, { sort: 'custom', fields: ['id'], noCache: true }));
});

test('deep JSON pages match cached pages at middle, final and past-end offsets', (context) => {
  isolatedCache(context);
  const root = fixture(context, Array.from({ length: 20_200 }, (_, index) => task(index + 2000, {
    rank: 20_200 - index,
  })));
  assert.equal(refreshSearchIndex(root), true);
  for (const offset of [10_100, 20_199, Number.MAX_SAFE_INTEGER]) {
    const options = { fields: ['id'], sort: 'rank', descending: true, offset, limit: 3 };
    const json = listTasks(root, { ...options, noCache: true });
    assert.equal(json.total, 20_200);
    assert.deepEqual(listTasks(root, options), json);
  }
});

test('cached descending custom sort places missing and null values first', (context) => {
  isolatedCache(context);
  const root = fixture(context, [
    task(1, { rank: 1 }), task(2), task(3, { rank: 2 }), task(4, { rank: null }),
  ]);
  assert.equal(refreshSearchIndex(root), true);
  for (const descending of [false, true]) {
    const options = { sort: 'rank', descending, fields: ['id'] };
    assert.deepEqual(listTasks(root, options), listTasks(root, { ...options, noCache: true }));
  }
  assert.deepEqual(listTasks(root, { sort: 'rank', descending: true, fields: ['id'] }).tasks,
    [{ id: 2 }, { id: 4 }, { id: 3 }, { id: 1 }]);
});

test('mixed numeric and text sort keeps the established JSON ordering', (context) => {
  isolatedCache(context);
  const root = fixture(context, [
    task(1, { custom: 2 }), task(2, { custom: '10' }), task(3, { custom: 10 }),
  ]);
  const options = { sort: 'custom', fields: ['id'] };
  const expected = listTasks(root, { ...options, noCache: true });
  assert.equal(refreshSearchIndex(root), true);
  let reads = 0;
  const original = fs.openSync;
  context.mock.method(fs, 'openSync', (path, ...args) => {
    if (String(path) === join(root, 'tasks/active.json')) reads++;
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(listTasks(root, options), expected);
    assert.ok(reads > 0, 'mixed sort must use authoritative JSON');
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('mixed custom sorts use the same bounded JSON page with a current cache', (context) => {
  isolatedCache(context);
  const values = ['10', 2, '10', '2', '3', '2', 10, '10'];
  const root = fixture(context, Array.from({ length: 20_200 }, (_, index) => task(index + 2000, {
    rank: index < values.length ? values[index] : 20_200 - index,
  })));
  assert.equal(refreshSearchIndex(root), true);
  for (const offset of [0, 10_100, 20_199]) {
    const options = { sort: 'rank', fields: ['id'], offset, limit: 3 };
    assert.deepEqual(listTasks(root, options), listTasks(root, { ...options, noCache: true }));
  }
});

test('refresh retains the previous complete cache generation and prunes older ones', (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1)]);
  assert.equal(refreshSearchIndex(root), true);
  const paths = searchIndexPaths(root);
  const first = JSON.parse(readFileSync(paths.pointer, 'utf8')).database;
  writeStore(root, 'active.json', [task(1, { title: 'Second' })]);
  assert.equal(refreshSearchIndex(root), true);
  const second = JSON.parse(readFileSync(paths.pointer, 'utf8')).database;
  assert.ok(readdirSync(paths.directory).includes(first));
  writeStore(root, 'active.json', [task(1, { title: 'Third' })]);
  assert.equal(refreshSearchIndex(root), true);
  const files = readdirSync(paths.directory);
  assert.ok(files.includes(second));
  assert.ok(!files.includes(first));
  assert.equal(getTask(root, 1).title, 'Third');
});

test('failed cache publication preserves the last complete generation and current JSON', (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1)]);
  assert.equal(refreshSearchIndex(root), true);
  const paths = searchIndexPaths(root);
  const previous = readFileSync(paths.pointer);
  writeStore(root, 'active.json', [task(1, { title: 'Changed JSON' })]);
  const rename = fs.renameSync;
  context.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to) === paths.pointer) throw Object.assign(new Error('test publication failure'), { code: 'TEST_PUBLISH' });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => refreshSearchIndex(root), { code: 'TEST_PUBLISH' });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(readFileSync(paths.pointer), previous);
  assert.deepEqual(readdirSync(paths.directory).filter((name) => /^index-[a-f0-9]{64}\.sqlite$/.test(name)),
    [JSON.parse(previous).database]);
  assert.equal(getTask(root, 1, { noCache: true }).title, 'Changed JSON');
  assert.equal(refreshSearchIndex(root), true);
  assert.equal(getTask(root, 1).title, 'Changed JSON');
});

test('manual edits and supported writes fall back immediately then refresh the same results', async (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1), task(2)]);
  assert.equal(refreshSearchIndex(root), true);
  writeStore(root, 'active.json', [task(1, { title: 'Manual edit' }), task(2)]);
  assert.equal(getTask(root, 1).title, 'Manual edit');
  const first = waitForSearchRefresh(root);
  assert.deepEqual(listTasks(root, { filters: [{ field: 'title', value: 'manual' }] }).tasks.map(({ id }) => id), [1]);
  assert.equal(waitForSearchRefresh(root), first);
  assert.ifError((await first).error);
  assert.equal(getTask(root, 1).title, 'Manual edit');

  const changed = updateTask(root, 1, { set: { title: 'Supported write' } });
  assert.equal(getTask(root, 1).title, changed.title);
  assert.ifError((await waitForSearchRefresh(root)).error);
  assert.equal(getTask(root, 1).title, 'Supported write');
});

test('corrupt replicas and failed refreshes keep authoritative JSON readable', async (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { title: 'Authoritative' })]);
  assert.equal(refreshSearchIndex(root), true);
  const paths = searchIndexPaths(root);
  const pointer = JSON.parse(readFileSync(paths.pointer, 'utf8'));
  writeFileSync(join(paths.directory, pointer.database), 'not a SQLite database');
  const rename = fs.renameSync;
  context.mock.method(fs, 'renameSync', (from, to) => {
    if (String(from).includes('.index-') && String(to).endsWith('.sqlite')) {
      throw Object.assign(new Error('refresh publication failed'), { code: 'TEST_REFRESH_FAILED' });
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(getTask(root, 1).title, 'Authoritative');
    const result = await waitForSearchRefresh(root);
    assert.equal(result.error.code, 'TEST_REFRESH_FAILED');
    assert.equal(listTasks(root, { fields: ['id'] }).tasks[0].id, 1);
    assert.equal((await waitForSearchRefresh(root)).error.code, 'TEST_REFRESH_FAILED');
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('readable schema-incompatible replicas fall back, rebuild and become readable', async (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(1, { title: 'Authoritative' })]);
  assert.equal(refreshSearchIndex(root), true);
  const paths = searchIndexPaths(root);
  const pointer = JSON.parse(readFileSync(paths.pointer, 'utf8'));
  const database = new (databaseSync())(join(paths.directory, pointer.database));
  try {
    database.exec('ALTER TABLE tasks RENAME TO incompatible_tasks');
  } finally {
    database.close();
  }

  assert.equal(getTask(root, 1).title, 'Authoritative');
  const refresh = await waitForSearchRefresh(root);
  assert.deepEqual(refresh, { refreshed: true });
  rejectStoreReads(context, root);
  try {
    assert.equal(getTask(root, 1).title, 'Authoritative');
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('noCache keeps every core task-data read on authoritative JSON without SQLite access', (context) => {
  isolatedCache(context);
  const root = fixture(context, [task(2, { blockers: [1], scope: 'JSON needle' }), task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    search: { mode: 'indexed' },
  });
  assert.equal(refreshSearchIndex(root), true);
  const DatabaseSync = databaseSync();
  let sqliteCalls = 0;
  for (const method of ['exec', 'prepare']) context.mock.method(DatabaseSync.prototype, method, () => {
    sqliteCalls++;
    throw new Error('SQLite cache must not be touched');
  });
  try {
    assert.deepEqual(listTasks(root, { noCache: true, fields: ['id'] }).tasks, [{ id: 1 }, { id: 2 }]);
    assert.equal(countTasks(root, { noCache: true }), 2);
    assert.equal(getTask(root, 2, { noCache: true }).scope, 'JSON needle');
    assert.deepEqual(getTasks(root, [2, 1], { noCache: true, fields: ['id'] }).tasks, [{ id: 2 }, { id: 1 }]);
    assert.deepEqual(searchTasks(root, 'needle', { noCache: true, fields: ['id'] }).tasks.map(({ id }) => id), [2]);
    assert.deepEqual(inspectBlockers(root, 2, { noCache: true }).activeBlockers, [1]);
    assert.equal(sqliteCalls, 0);
  } finally {
    context.mock.restoreAll();
  }
  for (const operation of [
    () => listTasks(root, { noCache: 'true' }),
    () => getTask(root, 1, { noCache: 1 }),
    () => getTasks(root, [1], { noCache: null }),
    () => searchTasks(root, 'task', { noCache: 'yes' }),
    () => inspectBlockers(root, 1, { noCache: 'true' }),
  ]) assert.throws(operation, { code: 'INVALID_INPUT' });
});

test('standalone task-data reads accept --no-cache when the cache path is unusable', (context) => {
  const cache = isolatedCache(context);
  const blocked = join(cache, 'not-a-directory');
  writeFileSync(blocked, 'cache unavailable');
  const root = fixture(context, [task(2, { blockers: [1], scope: 'JSON needle' }), task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    search: { mode: 'indexed' },
  });
  const extra = { env: { ...process.env, XDG_CACHE_HOME: blocked } };
  const commands = [
    ['list-tasks', [root, '--no-cache', '--format', 'json']],
    ['list-tasks', [root, '--no-cache', '--count']],
    ['get-task', [root, '2', '--no-cache', '--format', 'json']],
    ['get-tasks', [root, '--id', '2', '--no-cache', '--format', 'json']],
    ['search-tasks', [root, 'needle', '--no-cache', '--format', 'json']],
    ['inspect-blockers', [root, '2', '--no-cache', '--format', 'json']],
  ];
  for (const [name, args] of commands) {
    const result = run(name, args, extra);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /CACHE_|SQLite/);
  }
});

test('unavailable SQLite is a bounded advisory while core and CLI return JSON', (context) => {
  const root = fixture(context, [task(1)]);
  const preload = join(root, 'sqlite-unavailable.mjs');
  const sqliteModule = new URL('../src/sqlite.mjs', import.meta.url).href;
  writeFileSync(preload, `import { databaseSync } from ${JSON.stringify(sqliteModule)};\nconst DatabaseSync = databaseSync();\nconst exec = DatabaseSync.prototype.exec;\nDatabaseSync.prototype.exec = function(sql) { if (sql === 'SELECT 1') throw new Error('unavailable for test'); return exec.call(this, sql); };\n`);
  const env = { ...process.env, NODE_OPTIONS: `--import=${preload}` };
  const tasksModule = new URL('../src/tasks.mjs', import.meta.url).href;
  const source = `import { getTask } from ${JSON.stringify(tasksModule)};\nconst advisories = [];\nconst task = getTask(${JSON.stringify(root)}, 1, { onAdvisory: (item) => advisories.push(item) });\nprocess.stdout.write(JSON.stringify({ task, advisories }));\n`;
  const core = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', env });
  assert.equal(core.status, 0, core.stderr);
  const result = JSON.parse(core.stdout);
  assert.equal(result.task.id, 1);
  assert.deepEqual(result.advisories, [{
    code: 'CACHE_UNAVAILABLE', message: 'SQLite cache acceleration is unavailable; authoritative JSON was used.',
  }]);
  const command = run('get-task', [root, '1', '--format', 'json'], { env });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).id, 1);
  assert.equal(command.stderr, 'Advisory CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable; authoritative JSON was used.\n');
  assert.ok(Buffer.byteLength(command.stderr) < 256);
});

test('an unusable cache path falls back once without failing the core read', (context) => {
  const cache = isolatedCache(context);
  const blocked = join(cache, 'not-a-directory');
  writeFileSync(blocked, 'cache unavailable');
  process.env.XDG_CACHE_HOME = blocked;
  const root = fixture(context, [task(1)]);
  const advisories = [];
  assert.equal(getTask(root, 1, { onAdvisory: (item) => advisories.push(item) }).id, 1);
  assert.deepEqual(advisories, [{
    code: 'CACHE_UNAVAILABLE', message: 'SQLite cache acceleration is unavailable; authoritative JSON was used.',
  }]);
});
