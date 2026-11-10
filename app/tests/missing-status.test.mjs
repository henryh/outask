import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture, run, snapshot, writeStore } from './fixtures.mjs';
import { countTasks, getTask, listTasks } from '../src/tasks.mjs';
import { searchTasks } from '../src/search.mjs';
import { refreshSearchIndex } from '../src/search-index.mjs';
import { inspectBlockers } from '../src/blockers.mjs';
import { validateProject } from '../src/validation.mjs';
import { createTask } from '../src/create.mjs';
import { updateTask } from '../src/update.mjs';
import { transitionTask } from '../src/transition.mjs';
import { inspectSchema, materialiseSchema } from '../src/schema.mjs';

const legacy = (id, extra = {}) => ({ id, title: `Legacy ${id}`, scope: 'String scope', acceptance: 'String acceptance', custom: { retained: true }, ...extra });
const schema = () => ({ stores: {
  'active.json': { statuses: ['ready', 'started'], missing_status: 'ready' },
  'done.json': { statuses: ['shipped'], missing_status: 'shipped' },
}, groups: { Active: ['ready', 'started'], Done: ['shipped'], Archive: [] }, working_statuses: ['started'],
fields: { scope: { type: 'string' }, acceptance: { type: 'string' } } });

test('effective statuses drive scan/index reads, counts, search, blockers and validation without migrating records', (t) => {
  const root = fixture(t, [legacy(1, { blockers: [2, 99] }), legacy(2)]);
  writeStore(root, 'done.json', [legacy(99)]);
  const before = snapshot(root);
  for (const noCache of [true, false]) {
    if (!noCache) assert.equal(refreshSearchIndex(root), true);
    assert.deepEqual(listTasks(root, { noCache }).tasks.map(row => row.status), ['pending', 'pending']);
    assert.equal(countTasks(root, { noCache, status: 'pending' }), 2);
    assert.equal(getTask(root, 99, { noCache, group: 'Done' }).status, 'done');
    assert.deepEqual(searchTasks(root, 'String scope', { noCache }).tasks.map(row => row.status), ['pending', 'pending']);
    assert.deepEqual(inspectBlockers(root, 1, { noCache }).activeBlockers, [2]);
  }
  assert.deepEqual(snapshot(root), before);
  assert.equal(validateProject(root).valid, true);
  for (const file of ['active.json', 'done.json']) assert.deepEqual(readFileSync(join(root, 'tasks', file)), before[file]);
  assert.equal(inspectSchema(root).stores['active.json'].missing_status, 'pending');
  assert.equal(materialiseSchema(root).stores['done.json'].missing_status, 'done');
  assert.equal(validateProject(root).valid, true);
  assert.equal(getTask(root, 1).status, 'pending');
  const cli = run('list-tasks', [root, '--format', 'json']);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).tasks[0].status, 'pending');
});

test('custom schemas explicitly select non-working fallbacks and preserve connection field types', (t) => {
  const root = fixture(t, [legacy(1)], schema());
  writeStore(root, 'done.json', [legacy(99)]);
  assert.equal(validateProject(root).valid, true);
  assert.deepEqual(getTask(root, 1), { ...legacy(1), status: 'ready' });
  assert.equal(getTask(root, 99, { group: 'Done' }).status, 'shipped');
  assert.equal(materialiseSchema(root, { replace: true }).stores['active.json'].missing_status, 'ready');
  const executable = fileURLToPath(new URL('../bin/outask', import.meta.url));
  for (const command of [['schema'], ['list', '--limit', '10', '--fields', 'id,title,status'], ['validate']]) {
    const result = spawnSync(process.execPath, [executable, ...command, '--project-path', root], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const path = join(root, 'docs/task-schema.json');
  for (const fallback of [undefined, null, '', 4, 'unknown', 'started', 'in_progress', 'review']) {
    const config = schema();
    if (fallback === undefined) delete config.stores['active.json'].missing_status;
    else config.stores['active.json'].missing_status = fallback;
    if (['in_progress', 'review'].includes(fallback)) {
      config.stores['active.json'].statuses.push(fallback);
      config.groups.Active.push(fallback);
    }
    writeFileSync(path, JSON.stringify(config));
    const before = snapshot(root);
    const schemaBefore = readFileSync(path);
    for (const operation of [() => listTasks(root, { noCache: true }), () => validateProject(root)]) {
      assert.throws(operation, error => {
        assert.ok(['INVALID_CONFIG', 'INVALID_STORE'].includes(error.code));
        assert.match(error.message, /active.json/);
        assert.match(error.message, /task-schema.json/);
        assert.match(error.message, /missing_status/);
        return true;
      });
    }
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(readFileSync(path), schemaBefore);
  }
});

test('explicit invalid statuses and absent status in unspecified stores are never repaired', (t) => {
  const root = fixture(t, []);
  for (const status of ['', ' ', null, 4, [], 'unknown']) {
    writeStore(root, 'active.json', [legacy(1, { status })]);
    const before = snapshot(root);
    assert.throws(() => getTask(root, 1, { noCache: true }), { code: 'INVALID_STORE' });
    assert.throws(() => validateProject(root), { code: 'INVALID_STORE' });
    assert.deepEqual(snapshot(root), before);
  }
  writeStore(root, 'active.json', [legacy(1, { status: 'review' })]);
  assert.equal(getTask(root, 1).status, 'review');
  for (const file of ['archive.json', 'other.json']) {
    writeStore(root, file, [legacy(8)]);
    assert.throws(() => listTasks(root, { stores: [file], noCache: true }), /missing status.*no fallback/);
  }
});

test('actual changes persist effective/final status while equal updates and transitions preserve all bytes', (t) => {
  const root = fixture(t, []);
  const path = join(root, 'tasks/active.json');
  writeFileSync(path, '[\r\n {"id":1,"title":"Legacy 1","scope":"String scope","acceptance":"String acceptance","custom":1.00e2}\r\n]\r\n');
  validateProject(root);
  const before = snapshot(root);
  assert.equal(updateTask(root, 1, { set: { scope: 'String scope', status: 'pending' } }).status, 'pending');
  assert.equal(transitionTask(root, 1, 'pending').status, 'pending');
  assert.deepEqual(snapshot(root), before);
  assert.throws(() => updateTask(root, 1, { unset: ['status'] }), { code: 'INVALID_INPUT' });
  const saved = updateTask(root, 1, { set: { title: 'Edited' } });
  assert.equal(saved.status, 'pending');
  assert.ok(saved.updated_at);
  assert.match(readFileSync(path, 'utf8'), /"custom":1.00e2/);
  assert.equal(JSON.parse(readFileSync(path))[0].status, 'pending');
  writeStore(root, 'active.json', [legacy(2), legacy(3, { blockers: [2] })]);
  assert.throws(() => transitionTask(root, 3, 'review'), { code: 'ACTIVE_BLOCKERS' });
  assert.throws(() => createTask(root, { title: 'Blocked', status: 'in_progress', blockers: [2] }), { code: 'ACTIVE_BLOCKERS' });
  assert.equal(transitionTask(root, 2, 'done').status, 'done');
  assert.equal(JSON.parse(readFileSync(join(root, 'tasks/done.json'))).find(row => row.id === 2).status, 'done');
  assert.equal(createTask(root, { title: 'New' }).status, 'pending');
});
