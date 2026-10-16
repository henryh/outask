import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectSchema, materialiseSchema } from '../src/schema.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, run, snapshot, task } from './fixtures.mjs';

const executable = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const cli = (root, args) => spawnSync(process.execPath, [executable, 'schema', ...args], {
  cwd: root, encoding: 'utf8', timeout: 10000,
});

test('no-schema inspection expands defaults without creating configuration or stores', (t) => {
  const root = fixture(t, [task(1)]);
  rmSync(join(root, 'tasks/active.json'));
  rmSync(join(root, 'tasks/done.json'));
  rmSync(join(root, 'tasks/.task-tracker.json'));
  const expected = {
    format: 'standard', default_status: 'pending', working_statuses: ['in_progress', 'review'],
    stores: {
      'active.json': { statuses: ['pending', 'in_progress', 'review'] },
      'done.json': { statuses: ['done'] }, 'archive.json': { statuses: ['cancelled'] },
    },
    groups: { Active: ['pending', 'in_progress', 'review'], Done: ['done'], Archive: ['cancelled'] },
    search: { mode: 'scan' },
  };
  assert.deepEqual(inspectSchema(root), expected);
  const detached = inspectSchema(root);
  detached.stores['active.json'].statuses.push('caller-only');
  assert.deepEqual(inspectSchema(root), expected);
  const before = snapshot(root);
  const result = cli(root, []);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.deepEqual(JSON.parse(run('schema', [root]).stdout), expected);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(Object.keys(before), ['.task-tracker.json']);
  assert.deepEqual(materialiseSchema(root), expected);
  assert.equal(existsSync(join(root, 'tasks/active.json')), false);
});

test('CLI materialises validation-ready JSON, refuses overwrite and permits explicit replacement', (t) => {
  const root = fixture(t, [task(1, { extension: { retained: true } })]);
  const before = snapshot(root);
  const result = cli(root, ['--write']);
  assert.equal(result.status, 0, result.stderr);
  const path = join(root, 'tasks/task-schema.json');
  assert.equal(readFileSync(path, 'utf8'), result.stdout);
  assert.equal(validateProject(root).valid, true);
  for (const file of ['active.json', 'done.json']) assert.deepEqual(readFileSync(join(root, 'tasks', file)), before[file]);
  const written = snapshot(root);
  const refused = cli(root, ['--write']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /FILE_EXISTS/);
  assert.deepEqual(snapshot(root), written);
  assert.equal(cli(root, ['--replace']).status, 1);
  assert.deepEqual(snapshot(root), written);
  assert.equal(cli(root, ['--write', '--replace']).status, 0);
  assert.deepEqual(snapshot(root), written);
});

test('selected custom and legacy schemas retain fields and explicit semantics', (t) => {
  const config = {
    stores: { 'active.json': { statuses: ['queued', 'working'], extension: 'keep' }, 'done.json': { statuses: ['finished'] } },
    groups: { Active: ['queued', 'working'], Done: ['finished'] },
    format: 'minimal', default_status: 'queued', working_statuses: ['working'],
    fields: { scope: { type: 'string' } }, extension: { nested: ['unchanged'] },
  };
  const root = fixture(t, [task(1, { status: 'queued' })], config);
  rmSync(join(root, 'tasks/done.json'));
  const result = run('schema', [root, '--write', '--replace']);
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  for (const key of ['stores', 'format', 'default_status', 'working_statuses', 'fields', 'extension']) {
    assert.deepEqual(schema[key], config[key]);
  }
  assert.equal(validateProject(root).valid, true);
  assert.equal(existsSync(join(root, 'tasks/task-schema.json')), false);
  const custom = join(root, 'tasks/custom-schema.json');
  writeFileSync(custom, JSON.stringify(schema));
  const selected = cli(root, ['--schema-path', 'tasks/custom-schema.json', '--write', '--replace']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout), schema);
  assert.equal(validateProject(root, { schemaPath: 'tasks/custom-schema.json' }).valid, true);
});

test('invalid stores, unsafe paths and oversized schema fail without altering schema or task bytes', (t) => {
  const root = fixture(t, [task(1, { status: 'invalid' })]);
  const before = snapshot(root);
  assert.throws(() => materialiseSchema(root), { code: 'INVALID_STORE' });
  assert.deepEqual(snapshot(root), before);
  for (const schemaPath of ['../outside.json', 'missing.json']) {
    assert.throws(() => materialiseSchema(root, { schemaPath }));
    assert.deepEqual(snapshot(root), before);
  }
  symlinkSync('active.json', join(root, 'tasks/task-schema.json'));
  assert.throws(() => materialiseSchema(root, { replace: true }), { code: 'INVALID_CONFIG' });
  rmSync(join(root, 'tasks/task-schema.json'));
  writeFileSync(join(root, 'tasks/task-schema.json'), JSON.stringify({
    stores: { 'active.json': { statuses: ['pending'] } }, extension: 'x'.repeat(32768),
  }));
  const oversized = snapshot(root);
  assert.throws(() => materialiseSchema(root, { replace: true }), { code: 'OUTPUT_TOO_LARGE' });
  assert.deepEqual(snapshot(root), oversized);
});

test('custom statuses without a pending default remain validation-ready', (t) => {
  const root = fixture(t, [task(1, { status: 'ready' })], {
    stores: { 'active.json': { statuses: ['ready'] } },
  });
  const schema = materialiseSchema(root, { replace: true });
  assert.equal(Object.hasOwn(schema, 'default_status'), false);
  assert.deepEqual(schema.working_statuses, []);
  assert.deepEqual(schema.groups, { Active: ['ready'], Done: [], Archive: [] });
  assert.equal(validateProject(root).valid, true);
});
