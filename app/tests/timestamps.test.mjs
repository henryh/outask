import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTask } from '../src/create.mjs';
import { getTask } from '../src/tasks.mjs';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const earlier = '2000-01-01T00:00:00.000Z';
function rejected(root, operation, code) {
  const before = snapshot(root);
  assert.throws(operation, { code });
  assert.deepEqual(snapshot(root), before);
}

function atTime(milliseconds, operation) {
  const original = Date.now;
  Date.now = () => milliseconds;
  try { return operation(); } finally { Date.now = original; }
}

test('creation stamps its own canonical time and mutations advance through equal or rolled-back clocks', (t) => {
  const root = fixture(t, []);
  const clock = Date.parse(earlier);
  const created = atTime(clock, () => createTask(root, { title: 'Stamped' }));
  assert.equal(created.updated_at, earlier);
  const moved = atTime(clock, () => transitionTask(root, created.id, 'done', { ifUpdatedAt: earlier }));
  assert.equal(moved.updated_at, '2000-01-01T00:00:00.001Z');
  const restored = atTime(clock - 86400000, () => transitionTask(root, created.id, 'pending', { ifUpdatedAt: moved.updated_at }));
  assert.equal(restored.updated_at, '2000-01-01T00:00:00.002Z');
  for (const updated_at of [earlier, null, 'invalid']) {
    rejected(root, () => createTask(root, { title: 'Supplied date', updated_at }), 'INVALID_INPUT');
  }
});

test('legacy and timestamped no-ops preserve all bytes while same-status store moves advance timestamps', (t) => {
  const root = fixture(t, [task(1), task(2, { updated_at: earlier })]);
  assert.deepEqual(getTask(root, 1, { fields: ['id', 'updated_at'] }), { id: 1 });
  for (const id of [1, 2]) {
    const before = snapshot(root);
    const result = transitionTask(root, id, 'pending');
    assert.equal(result.updated_at, id === 1 ? undefined : earlier);
    assert.deepEqual(snapshot(root), before);
  }
  rejected(root, () => transitionTask(root, 1, 'pending', { ifUpdatedAt: earlier }), 'TRANSITION_CONFLICT');
  rejected(root, () => transitionTask(root, 2, 'pending', { ifUpdatedAt: '2000-01-01T00:00:00.001Z' }), 'TRANSITION_CONFLICT');
  const configured = fixture(t, [task(1, { updated_at: earlier })], {
    stores: { 'active.json': { statuses: ['pending'] }, 'queue.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    groups: { Active: ['pending'], Done: ['done'] },
  });
  writeStore(configured, 'queue.json', []);
  const moved = atTime(Date.parse(earlier), () => transitionTask(configured, 1, 'pending', { store: 'queue', ifUpdatedAt: earlier }));
  assert.equal(moved.updated_at, '2000-01-01T00:00:00.001Z');
  assert.equal(getTask(configured, 1, { stores: ['queue'] }).updated_at, moved.updated_at);
  assert.deepEqual(JSON.parse(readFileSync(join(configured, 'tasks/active.json'))), []);
});

test('scripts use optional exact date preconditions and protect advanced manual edits', (t) => {
  const root = fixture(t, [task(1, { updated_at: earlier })]);
  writeStore(root, 'archive.json', []);
  const manual = '2099-01-01T00:00:00.000Z';
  writeStore(root, 'active.json', [task(1, { updated_at: manual, extension: 'manual change' })]);
  const before = snapshot(root);
  const stale = run('transition-task', [root, '1', '--status', 'done', '--if-updated-at', earlier]);
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout, '');
  assert.match(stale.stderr, /TRANSITION_CONFLICT.*2099-01-01T00:00:00.000Z.*2000-01-01T00:00:00.000Z/);
  assert.deepEqual(snapshot(root), before);
  const archived = run('delete-task', [root, '1', '--if-updated-at', manual]);
  assert.equal(archived.status, 0, archived.stderr);
  assert.deepEqual(JSON.parse(archived.stdout), task(1, { status: 'cancelled', updated_at: '2099-01-01T00:00:00.001Z', extension: 'manual change' }));
  const removed = run('transition-task', [root, '1', '--status', 'pending', '--from', 'archive']);
  assert.equal(removed.status, 1);
  assert.match(removed.stderr, /INVALID_INPUT.*--from/);
  rejected(root, () => transitionTask(root, 1, 'pending', { from: 'archive' }), 'INVALID_INPUT');
});

test('invalid stored and expected timestamps fail safely, including exempt stores', (t) => {
  const root = fixture(t, [task(1)]);
  for (const value of [null, 1, '2026-02-30T00:00:00.000Z', '2026-09-19', '2026-09-19T00:00:00Z', '2026-09-19T03:00:00.000+03:00', '+999999-01-01T00:00:00.000Z']) {
    rejected(root, () => transitionTask(root, 1, 'done', { ifUpdatedAt: value }), 'INVALID_INPUT');
    writeStore(root, 'active.json', [task(1, { updated_at: value })]);
    rejected(root, () => validateProject(root), 'INVALID_STORE');
    rejected(root, () => getTask(root, 1), 'INVALID_STORE');
    rejected(root, () => transitionTask(root, 1, 'done'), 'INVALID_STORE');
    writeStore(root, 'active.json', [task(1)]);
  }
  const exempt = fixture(t, [task(1, { updated_at: 'invalid' })], {
    stores: { 'active.json': { statuses: ['pending'], validate: false }, 'done.json': { statuses: ['done'] } },
  });
  rejected(exempt, () => validateProject(exempt), 'INVALID_STORE');
  rejected(exempt, () => transitionTask(exempt, 1, 'done'), 'INVALID_STORE');
});

test('maximum canonical timestamps remain readable and no-op safely but cannot advance', (t) => {
  const updated_at = '+275760-09-13T00:00:00.000Z';
  const root = fixture(t, [task(1, { updated_at })]);
  validateProject(root);
  assert.equal(getTask(root, 1).updated_at, updated_at);
  const before = snapshot(root);
  assert.equal(transitionTask(root, 1, 'pending', { ifUpdatedAt: updated_at }).updated_at, updated_at);
  assert.deepEqual(snapshot(root), before);
  rejected(root, () => transitionTask(root, 1, 'done'), 'TIMESTAMP_EXHAUSTED');
});

test('status and date edits preserve shadowed duplicate fields, numeric literals and escaped keys', (t) => {
  const root = fixture(t, []);
  const original = '{"id":1,"title":"Task","number":9007199254740993,"status":{"old":true},"sta\\u0074us":"pending","updated_at":["old"],"updated_\\u0061t":"2000-01-01T00:00:00.000Z","extension":{"updated_at":null,"status":[1]}}';
  writeFileSync(join(root, 'tasks/active.json'), `[${original}]\n`);
  validateProject(root);
  const moved = atTime(Date.parse(earlier), () => transitionTask(root, 1, 'done', { ifUpdatedAt: earlier }));
  assert.equal(moved.updated_at, '2000-01-01T00:00:00.001Z');
  const expected = original.replace('"pending"', '"done"').replace(earlier, moved.updated_at);
  assert.ok(readFileSync(join(root, 'tasks/done.json'), 'utf8').includes(expected));
  assert.equal(validateProject(root).refreshed, false);
});

test('history source discovery stops after finding the ID and preserves unconfigured-source rejection', (t) => {
  const root = fixture(t, []);
  writeStore(root, 'archive.json', [task(200, { status: 'cancelled', marker: 'UNRELATED_HISTORY_SENTINEL' })]);
  validateProject(root);
  const parse = JSON.parse;
  let unrelated = 0;
  JSON.parse = (source, ...args) => {
    if (String(source).includes('UNRELATED_HISTORY_SENTINEL')) unrelated++;
    return parse(source, ...args);
  };
  try { assert.equal(transitionTask(root, 99, 'pending').id, 99); } finally { JSON.parse = parse; }
  assert.equal(unrelated, 0);
  writeStore(root, 'retained.json', [task(300, { status: 'legacy' })]);
  rejected(root, () => transitionTask(root, 300, 'pending'), 'INVALID_INPUT');
});
