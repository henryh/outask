import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { responseBytes } from '../src/limits.mjs';
import { refreshSearchIndex, waitForSearchRefresh } from '../src/search-index.mjs';
import { getTasks } from '../src/tasks.mjs';
import { fixture, run, task, writeStore } from './fixtures.mjs';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));

function cli(args, extra = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 10000, ...extra });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function isolatedCache(context) {
  const cache = mkdtempSync(join(tmpdir(), 'task-tracker-batch-index-'));
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  context.after(() => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    rmSync(cache, { recursive: true, force: true });
  });
}

test('batch retrieval preserves requested order, projects fields and reports missing IDs', (context) => {
  const root = fixture(context, [task(1), task(2, { custom: 'kept' }), task(3)]);
  const page = getTasks(root, [3, 99, 1], { fields: ['id', 'title'] });
  assert.deepEqual(page.tasks, [{ id: 3, title: 'Task 3' }, { id: 1, title: 'Task 1' }]);
  assert.deepEqual(page.not_found, [99]);
  assert.equal(page.hasMore, false);
  assert.equal(page.next_cursor, null);
  assert.deepEqual(page.fields, ['id', 'title']);
  assert.deepEqual(getTasks(root, [2], { fields: ['all'] }).tasks, [task(2, { custom: 'kept' })]);
});

test('batch selection includes requested history without changing source order', (context) => {
  const root = fixture(context, [task(1), task(2)]);
  writeStore(root, 'done.json', [task(9, { status: 'done', completed_at: '2026-09-17T00:00:00Z' })]);
  assert.deepEqual(getTasks(root, [9, 1], { stores: ['all'], fields: ['id'] }).tasks.map((row) => row.id), [9, 1]);
  assert.deepEqual(getTasks(root, [1, 9], { group: 'Done', fields: ['id'] }), {
    tasks: [{ id: 9 }], not_found: [1], hasMore: false, next_cursor: null,
    stores: ['done.json'], fields: ['id'],
  });
  assert.throws(() => getTasks(root, [1], { stores: ['all'], group: 'Active' }), { code: 'INVALID_INPUT' });
});

test('batch cursors are bound to ordered IDs and selectors', (context) => {
  const root = fixture(context, [task(1), task(2), task(3)]);
  const first = getTasks(root, [3, 99, 2, 1], { fields: ['id'], limit: 2 });
  assert.deepEqual(first.tasks, [{ id: 3 }]);
  assert.deepEqual(first.not_found, [99]);
  assert.equal(first.hasMore, true);
  const second = getTasks(root, [3, 99, 2, 1], { fields: ['id'], limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.tasks, [{ id: 2 }, { id: 1 }]);
  assert.equal(second.hasMore, false);
  for (const operation of [
    () => getTasks(root, [3, 2, 99, 1], { fields: ['id'], limit: 2, cursor: first.next_cursor }),
    () => getTasks(root, [3, 99, 2, 1], { fields: ['title'], limit: 2, cursor: first.next_cursor }),
    () => getTasks(root, [3, 99, 2, 1], { group: 'Done', limit: 2, cursor: first.next_cursor }),
    () => getTasks(root, [3, 99, 2, 1], { cursor: 'bad' }),
  ]) assert.throws(operation, { code: 'INVALID_CURSOR' });
});

test('batch validates IDs and returns byte-bounded partial pages', (context) => {
  const root = fixture(context, [
    task(1, { details: 'a'.repeat(18_000) }),
    task(2, { details: 'b'.repeat(18_000) }),
    task(3, { details: 'c'.repeat(40_000) }),
  ]);
  for (const ids of [[], [0], [1.5], [1, 1]]) assert.throws(() => getTasks(root, ids), { code: 'INVALID_INPUT' });
  const first = getTasks(root, [1, 2], { fields: ['all'], limit: 2 });
  assert.deepEqual(first.tasks.map((row) => row.id), [1]);
  assert.equal(first.hasMore, true);
  assert.ok(Buffer.byteLength(`${JSON.stringify(first, null, 2)}\n`) <= responseBytes);
  const second = getTasks(root, [1, 2], { fields: ['all'], limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.tasks.map((row) => row.id), [2]);
  assert.throws(() => getTasks(root, [3], { fields: ['all'] }), (error) => {
    assert.equal(error.code, 'OUTPUT_TOO_LARGE');
    assert.match(error.message, /select fewer --fields/);
    return true;
  });
});

test('indexed, auto and scan modes share fresh batch results', async (context) => {
  isolatedCache(context);
  const indexed = fixture(context, [task(1), task(2)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const advisories = [];
  assert.deepEqual(getTasks(indexed, [2, 1], { fields: ['id'], onAdvisory: (item) => advisories.push(item) }).tasks,
    [{ id: 2 }, { id: 1 }]);
  assert.equal(advisories[0].code, 'CACHE_FALLBACK');
  assert.equal(refreshSearchIndex(indexed), true);
  assert.deepEqual(getTasks(indexed, [2, 1], { fields: ['id'] }).tasks, [{ id: 2 }, { id: 1 }]);
  writeStore(indexed, 'active.json', [task(3)]);
  assert.deepEqual(getTasks(indexed, [2, 3], { fields: ['id'] }).tasks, [{ id: 3 }]);

  const automatic = fixture(context, [task(7)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'auto' },
  });
  assert.deepEqual(getTasks(automatic, [7], { fields: ['id'] }).tasks, [{ id: 7 }]);
  await waitForSearchRefresh(automatic);
  assert.deepEqual(getTasks(automatic, [7], { fields: ['id'] }).tasks, [{ id: 7 }]);
  writeStore(automatic, 'active.json', [task(8)]);
  const refreshed = getTasks(automatic, [7, 8], { fields: ['id'] });
  assert.deepEqual(refreshed.tasks, [{ id: 8 }]);
  assert.deepEqual(refreshed.not_found, [7]);
  await waitForSearchRefresh(automatic);
});

test('indexed batch reports an unusable cache root once and returns JSON', (context) => {
  const root = fixture(context, [task(1)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const blocked = join(root, 'cache-root');
  writeFileSync(blocked, 'not a directory');
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = blocked;
  const advisories = [];
  let page;
  try {
    page = getTasks(root, [1], { fields: ['id'], onAdvisory: (item) => advisories.push(item) });
  } finally {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
  }
  assert.deepEqual(page.tasks, [{ id: 1 }]);
  assert.deepEqual(advisories, [{
    code: 'CACHE_UNAVAILABLE', message: 'SQLite cache acceleration is unavailable; authoritative JSON was used.',
  }]);

  const command = run('get-tasks', [root, '--id', '1', '--fields', 'id', '--format', 'json'], {
    env: { ...process.env, XDG_CACHE_HOME: blocked },
  });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout).tasks, [{ id: 1 }]);
  assert.equal(command.stderr, 'Advisory CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable; authoritative JSON was used.\n');
  assert.equal(readFileSync(blocked, 'utf8'), 'not a directory');
});

test('standalone and installed batch commands share project selection and continuations', (context) => {
  const current = fixture(context, [task(1), task(2), task(3)]);
  const selected = fixture(context, [task(8), task(9)]);
  const standalone = run('get-tasks', ['--id', '3', '--id', '99', '--id', '1', '--fields', 'id', '--format', 'json'], { cwd: current });
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.deepEqual(JSON.parse(standalone.stdout).tasks, [{ id: 3 }, { id: 1 }]);
  assert.deepEqual(JSON.parse(standalone.stdout).not_found, [99]);
  const installed = cli(['get-many', '--project-path', selected, '--id', '9', '--id', '8', '--fields', 'id', '--format', 'json']);
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(installed.stdout).tasks, [{ id: 9 }, { id: 8 }]);
  const registry = join(current, 'registry.json');
  writeFileSync(registry, JSON.stringify({ projects: { selected } }));
  const named = cli(['get-many', '--project', 'selected', '--config', registry,
    '--id', '8', '--fields', 'id', '--format', 'json'], { cwd: current });
  assert.equal(named.status, 0, named.stderr);
  assert.deepEqual(JSON.parse(named.stdout).tasks, [{ id: 8 }]);
  const human = cli(['get-many', '--id', '1', '--id', '2', '--id', '3', '--limit', '1', '--fields', 'id'], { cwd: current });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stderr, /Next page: tasks get-many --cursor [A-Za-z0-9_-]+ --id 1 --id 2 --id 3/);
  const duplicate = cli(['get-many', '--id', '1', '--id', '1'], { cwd: current });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /^INVALID_INPUT: ids must not contain duplicates/);
});
