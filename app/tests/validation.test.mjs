import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTask } from '../src/create.mjs';
import { projectBytes } from '../src/limits.mjs';
import { updateTask } from '../src/update.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const state = (root) => JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json'), 'utf8'));
const invalid = (root, pattern) => assert.throws(() => validateProject(root), pattern);

test('standalone validation preserves minimum, standard and PM data and refreshes manual edits', (t) => {
  const root = fixture(t, [task(1), task(2, { priority: 'high', blockers: [900], parent: 'elsewhere' }),
    task(3, { scope: 'Deliver', acceptance: ['Verify'], blockers: [], custom: { keep: true } })]);
  const before = snapshot(root);
  let result = run('validate-task-stores', [root, '--format', 'json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).counter, 99);
  for (const [file, bytes] of Object.entries(before)) if (file !== '.task-tracker.json') assert.deepEqual(readFileSync(join(root, 'tasks', file)), bytes);
  assert.equal(validateProject(root).refreshed, false);
  writeStore(root, 'active.json', [task(300)]);
  assert.equal(validateProject(root).counter, 300);
  writeStore(root, '.task-tracker.json', { ...state(root), counter: 500, extra: { keep: true }, validated: { ...state(root).validated, note: 'retain' } });
  writeStore(root, 'archive.json', [task(400, { status: 'cancelled' })]);
  assert.equal(validateProject(root).counter, 500);
  assert.deepEqual(state(root).extra, { keep: true });
  assert.equal(state(root).validated.note, 'retain');
  assert.ok(state(root).validated.files['tasks/archive.json']);
  unlinkSync(join(root, 'tasks/archive.json'));
  assert.equal(validateProject(root).refreshed, true);
  assert.equal(state(root).validated.files['tasks/archive.json'], undefined);
  writeStore(root, 'active.json', [task(301, { priority: 'urgent' })]);
  const failed = snapshot(root);
  result = run('validate-task-stores', [root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /active.json\[0\].*301.*priority/);
  assert.equal(result.stdout, '');
  assert.deepEqual(snapshot(root), failed);
});

test('configured requirements, optional review, plan fields and config fingerprints', (t) => {
  const config = { stores: { 'active.json': { statuses: ['pending', 'in_progress'], required_fields: ['acceptance'] }, 'done.json': { statuses: ['done'] } }, required_fields: ['scope'], plan: { required_for_statuses: ['in_progress'] } };
  const root = fixture(t, [task(1, { scope: 'Work', acceptance: ['Check'] })], config);
  writeStore(root, 'done.json', [task(99, { status: 'done', scope: 'Finished' })]);
  validateProject(root);
  const old = state(root);
  config.required_fields.push('estimate');
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify(config));
  invalid(root, /estimate is required/);
  assert.deepEqual(state(root), old);
  config.required_fields.pop();
  config.plan.required_for_statuses = [];
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify(config));
  assert.equal(validateProject(root).refreshed, true);
  writeStore(root, 'active.json', [task(1, { status: 'review', scope: 'Work', acceptance: ['Check'] })]);
  invalid(root, /status must be one of pending, in_progress/);
  config.plan.required_for_statuses = ['in_progress'];
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify(config));
  writeStore(root, 'active.json', [task(1, { status: 'in_progress', scope: 'Work', acceptance: ['Check'] })]);
  invalid(root, /techdesign is required/);
  writeStore(root, 'active.json', [task(1, { status: 'in_progress', scope: 'Work', acceptance: ['Check'], techdesign: 'Design', stages: ['Implement'] })]);
  assert.equal(validateProject(root).valid, true);
});

test('field rules keep defaults minimal and enforce configured project contracts', (t) => {
  const minimal = fixture(t, [{ id: 1, title: 'Minimal', status: 'pending' }, task(2, { blockers: [] })]);
  assert.equal(validateProject(minimal).valid, true);

  const config = {
    stores: { 'active.json': { statuses: ['pending', 'in_progress'] }, 'done.json': { statuses: ['done'] } },
    groups: { Active: ['pending', 'in_progress'], Done: ['done'] },
    fields: {
      scope: { type: 'string', required: true, non_empty: true },
      acceptance: { type: 'array', required: true, min_items: 1, items: 'string', non_empty_items: true },
      blockers: { type: 'array', required: true, items: 'integer' },
      completed_at: { type: 'date', required_for_statuses: ['done'] },
      techdesign: { type: 'string', non_empty: true },
      stages: { type: 'array', min_items: 1, items: 'string', non_empty_items: true },
    },
  };
  const root = fixture(t, [task(1, { scope: 'Work', acceptance: ['Check'], blockers: [] })], config);
  writeStore(root, 'done.json', [task(2, {
    status: 'done', scope: 'Finished', acceptance: ['Checked'], blockers: [], completed_at: '2026-09-17',
  })]);
  assert.equal(validateProject(root).valid, true);
  writeStore(root, 'active.json', [task(1, { scope: {}, acceptance: ['Check'], blockers: [] })]);
  invalid(root, /scope must be a string/);
  writeStore(root, 'active.json', [task(1, { scope: 'Work', acceptance: [''], blockers: [] })]);
  invalid(root, /acceptance\[0\] must be a non-empty string/);
  writeStore(root, 'active.json', [task(1, { scope: 'Work', acceptance: ['Check'], blockers: [], techdesign: ' ' })]);
  invalid(root, /techdesign must be a non-empty string/);
  writeStore(root, 'active.json', [task(1, { scope: 'Work', acceptance: ['Check'], blockers: [] })]);
  writeStore(root, 'done.json', [task(2, { status: 'done', scope: 'Finished', acceptance: ['Checked'], blockers: [] })]);
  invalid(root, /completed_at is required/);
  writeStore(root, 'done.json', [task(2, {
    status: 'done', scope: 'Finished', acceptance: ['Checked'], blockers: [], completed_at: 'not-a-date',
  })]);
  invalid(root, /completed_at must be a valid date string/);
});

test('create and update use configured field rules without persisting rejected records', (t) => {
  const config = {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    groups: { Active: ['pending'], Done: ['done'] },
    fields: {
      scope: { type: 'string', required: true, non_empty: true },
      acceptance: { type: 'array', required: true, min_items: 1, items: 'string', non_empty_items: true },
      blockers: { type: 'array', required: true, items: 'integer' },
      completed_at: { type: 'date', required_for_statuses: ['done'] },
    },
  };
  const root = fixture(t, [task(1, { scope: 'Work', acceptance: ['Check'], blockers: [] })], config);
  writeStore(root, 'done.json', []);
  const beforeCreate = snapshot(root);
  assert.throws(() => createTask(root, { title: 'Missing scope', acceptance: ['Check'], blockers: [] }), /scope is required/);
  assert.deepEqual(snapshot(root), beforeCreate);
  const created = createTask(root, { title: 'Configured', scope: 'Work', acceptance: ['Check'], blockers: [] });
  assert.equal(created.id, 2);
  const beforeUpdate = snapshot(root);
  assert.throws(() => updateTask(root, 1, { unset: ['acceptance'] }), /acceptance is required/);
  assert.deepEqual(snapshot(root), beforeUpdate);
  assert.throws(() => updateTask(root, 1, { set: { status: 'done' } }), /completed_at is required/);
  assert.deepEqual(snapshot(root), beforeUpdate);
  const done = updateTask(root, 1, { set: { status: 'done', completed_at: '2026-09-23T00:00:00Z' } });
  assert.equal(done.status, 'done');
});

test('all retained stores enforce IDs including exemptions while extension fields remain passive', (t) => {
  const root = fixture(t, [task(1, { scope: {}, acceptance: false, completed_at: 'project-defined' })], {
    stores: { 'active.json': { statuses: ['pending'] }, 'legacy.json': { statuses: ['old'], validate: false } },
    groups: { Active: ['pending'], Archive: ['old'] },
  });
  writeStore(root, 'legacy.json', [{ id: 700, arbitrary: true }]);
  assert.equal(validateProject(root).counter, 700);
  writeStore(root, 'legacy.json', [{ id: 99 }]);
  invalid(root, /duplicate id 99/);
  writeStore(root, 'legacy.json', [{ id: '700' }]);
  invalid(root, /id must be a positive safe integer/);
  writeStore(root, 'legacy.json', {});
  invalid(root, /root value must be an array/);
});

test('only Active links form cycles; inactive and external targets need no resolution', (t) => {
  const root = fixture(t, [task(1, { blockers: [2, 900], link: '/missing/project/9' }), task(2, { blockers: [1] })]);
  invalid(root, /blockers creates an active cycle/);
  writeStore(root, 'active.json', [task(1, { blockers: [1] })]);
  invalid(root, /blockers must not contain its own id/);
  writeStore(root, 'active.json', [task(1, { blockers: [2, 900] })]);
  writeStore(root, 'done.json', [task(2, { status: 'done', blockers: [1, 900] })]);
  assert.equal(validateProject(root).valid, true);
  writeStore(root, 'active.json', [task(1, { blockers: ['elsewhere#2'] })]);
  invalid(root, /blockers must be an array/);
});

test('missing counters preserve metadata and malformed sources never create certification', (t) => {
  const root = fixture(t, [task(1)]);
  writeStore(root, '.task-tracker.json', { note: 'keep' });
  assert.equal(validateProject(root).counter, 99);
  assert.equal(state(root).note, 'keep');
  writeStore(root, '.task-tracker.json', { counter: -1 });
  invalid(root, /non-negative safe integer counter/);
  unlinkSync(join(root, 'tasks/.task-tracker.json'));
  writeFileSync(join(root, 'tasks/active.json'), '[');
  invalid(root, /invalid JSON/);
  assert.deepEqual(state(root), {});
});

test('configuration addition/removal invalidates state and locks prevent concurrent refresh', (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  assert.equal(state(root).validated.files['tasks/task-schema.json'], null);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } } }));
  assert.equal(validateProject(root).refreshed, true);
  unlinkSync(join(root, 'docs/task-schema.json'));
  assert.equal(validateProject(root).refreshed, true);
  writeFileSync(join(root, 'tasks/.task-tracker.json.lock'), '');
  const before = snapshot(root);
  invalid(root, /cannot lock validation.*EEXIST/);
  assert.deepEqual(snapshot(root), before);
});

test('deep Active graphs validate without call-stack limits and errors stay bounded', (t) => {
  const records = Array.from({ length: 12000 }, (_, index) => task(index + 100, {
    blockers: index === 11999 ? [999999] : [index + 101],
  }));
  const root = fixture(t, records);
  assert.equal(validateProject(root).tasks, 12001);
  records.at(-1).blockers = [100];
  writeStore(root, 'active.json', records);
  invalid(root, /active cycle/);
});

test('invalid required-field configuration and oversized inputs preserve service state', (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  const old = state(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } }, required_fields: 'scope' }));
  invalid(root, /required_fields must be an array/);
  assert.deepEqual(state(root), old);
  unlinkSync(join(root, 'docs/task-schema.json'));
  writeFileSync(join(root, 'tasks/active.json'), ' '.repeat(projectBytes + 1));
  invalid(root, new RegExp(`${projectBytes / 1024 / 1024} MiB read budget`));
  assert.deepEqual(state(root), old);
});


test('standalone validation rejects literal null service state without rewriting it', (t) => {
  const root = fixture(t, [task(1)]);
  writeFileSync(join(root, 'tasks/.task-tracker.json'), 'null\n');
  const before = snapshot(root);
  const result = run('validate-task-stores', [root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_SERVICE.*expected an object/);
  assert.deepEqual(snapshot(root), before);
});
