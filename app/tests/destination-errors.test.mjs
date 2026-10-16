import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTask } from '../src/create.mjs';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

function rejected(root, operation, patterns, code = 'INVALID_INPUT') {
  const before = snapshot(root);
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    for (const pattern of patterns) assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual(snapshot(root), before);
}

test('a destination typo reports the actual configured statuses without writes', (t) => {
  const root = fixture(t, [task(1)]);
  const before = snapshot(root);
  const result = run('transition-task', [root, '1', '--status', 'dane']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^INVALID_INPUT: unknown status values: --status="dane";/);
  assert.match(result.stderr, /allowed configured statuses: cancelled, done, in_progress, pending, review/);
  assert.doesNotMatch(result.stderr, /--store/);
  assert.deepEqual(snapshot(root), before);
});

test('create and lifecycle distinguish custom status errors, ambiguous destinations and incompatible stores', (t) => {
  const root = fixture(t, [task(1, { status: 'todo' })], {
    stores: { 'active.json': { statuses: ['todo', 'doing'] }, 'queue.json': { statuses: ['todo'] }, 'done.json': { statuses: ['finished'] } },
    groups: { Active: ['todo', 'doing'], Done: ['finished'] }, default_status: 'todo',
  });
  writeStore(root, 'queue.json', []);
  writeStore(root, 'done.json', []);
  const allowed = /allowed configured statuses: doing, finished, todo/;
  rejected(root, () => transitionTask(root, 1, 'done', {}), [/--status="done"/, allowed]);
  rejected(root, () => createTask(root, { title: 'New', status: 'done' }), [/status="done"/, allowed]);
  for (const operation of [
    () => createTask(root, { title: 'New' }),
    () => transitionTask(root, 1, 'todo', {}),
  ]) rejected(root, operation, [/multiple destinations/, /select --store from: active.json, queue.json/]);
  for (const store of ['done', 'missing']) {
    for (const operation of [
      () => createTask(root, { title: 'New' }, { store }),
      () => transitionTask(root, 1, 'todo', { store }),
    ]) rejected(root, operation, [new RegExp(`store "${store}" is not a configured destination`), /allowed destination stores: active.json, queue.json/]);
  }
});

test('delete distinguishes missing Archive configuration, status choices and destination choices', (t) => {
  const absent = fixture(t, [task(1)], { stores: { 'active.json': { statuses: ['pending'] } } });
  unlinkSync(join(absent, 'tasks/done.json'));
  rejected(absent, () => deleteTask(absent, 1, {}), [/no configured Archive status/, /configure an Archive destination/]);
  const root = fixture(t, [task(1, { status: 'todo' })], {
    stores: { 'active.json': { statuses: ['todo'] }, 'archive.json': { statuses: ['cancelled', 'deleted'] }, 'retired.json': { statuses: ['deleted'] } },
    groups: { Active: ['todo'], Archive: ['cancelled', 'deleted'] },
  });
  unlinkSync(join(root, 'tasks/done.json'));
  writeStore(root, 'archive.json', []);
  writeStore(root, 'retired.json', []);
  rejected(root, () => deleteTask(root, 1, {}), [/multiple Archive statuses/, /select --status from: cancelled, deleted/]);
  rejected(root, () => deleteTask(root, 1, { status: 'todo' }), [/status "todo" is not an Archive status/, /allowed Archive statuses: cancelled, deleted/]);
  rejected(root, () => deleteTask(root, 1, { status: 'canceled' }), [/--status="canceled"/, /allowed configured statuses: cancelled, deleted, todo/]);
  rejected(root, () => deleteTask(root, 1, { status: 'deleted' }), [/multiple destinations/, /select --store from: archive.json, retired.json/]);
  rejected(root, () => deleteTask(root, 1, { status: 'deleted', store: 'active' }), [/store "active" is not a configured destination/, /allowed destination stores: archive.json, retired.json/]);
});
