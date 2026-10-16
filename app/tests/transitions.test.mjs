import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTask } from '../src/create.mjs';
import { projectBytes } from '../src/limits.mjs';
import { inspectBlockers } from '../src/blockers.mjs';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { getTask } from '../src/tasks.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const state = (root) => JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json'), 'utf8'));
const script = fileURLToPath(new URL('../scripts/transition-task.mjs', import.meta.url));
function rejected(root, callback, code) {
  const before = snapshot(root);
  assert.throws(callback, { code });
  assert.deepEqual(snapshot(root), before);
}

function launch(root, args, preload) {
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), script, root, ...args], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const complete = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  return { child, complete };
}

function interruption(root, condition) {
  const path = join(root, 'interrupt.mjs');
  writeFileSync(path, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.renameSync;
fs.renameSync = (...args) => {
  const result = rename(...args);
  if (${condition}) process.exit(73);
  return result;
};
syncBuiltinESMExports();\n`);
  return path;
}

test('scripts complete, delete and restore retained IDs while releasing blockers and preserving source bytes', (t) => {
  const root = fixture(t, [task(1, { extension: { keep: true } }), task(2, { blockers: [1], extra: 'dependent' })]);
  writeStore(root, 'archive.json', []);
  const path = join(root, 'tasks/active.json');
  const source = '[\n  {"id":1,"title":"Task 1","status":"pending","number":9007199254740993,"escaped":"\\u0041","extension":{"keep":true}},\n  {"id":2,"title":"Task 2","status":"pending","blockers":[1],"extra":"dependent"}\n]\n';
  writeFileSync(path, source);
  const dependent = source.slice(source.indexOf('{"id":2'), source.lastIndexOf('}') + 1);
  rejected(root, () => transitionTask(root, 2, 'in_progress', {}), 'ACTIVE_BLOCKERS');
  const done = run('transition-task', ['1', '--status', 'done'], { cwd: root });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(JSON.parse(done.stdout).extension.keep, true);
  assert.match(readFileSync(join(root, 'tasks/done.json'), 'utf8'), /9007199254740993/);
  assert.ok(readFileSync(path, 'utf8').includes(dependent));
  assert.deepEqual(inspectBlockers(root, 2).activeBlockers, []);
  const archived = run('delete-task', [root, '2']);
  assert.equal(archived.status, 0, archived.stderr);
  assert.deepEqual(JSON.parse(archived.stdout).blockers, [1]);
  for (const [id, from] of [[1, 'done'], [2, 'archive']]) {
    const restored = run('transition-task', [root, String(id), '--status', 'pending']);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(JSON.parse(restored.stdout).id, id);
  }
  assert.match(readFileSync(path, 'utf8'), /9007199254740993/);
  assert.match(readFileSync(path, 'utf8'), /\\u0041/);
  assert.equal(state(root).counter, 99);
  assert.equal(validateProject(root).refreshed, false);
  assert.equal(createTask(root, { title: 'Next' }).id, 100);
});

test('custom groups have unrestricted transitions, explicit destinations and final field validation', (t) => {
  const root = fixture(t, [task(1, { status: 'todo', extension: 7 })], {
    stores: { 'active.json': { statuses: ['todo', 'doing'] }, 'done.json': { statuses: ['finished'], required_fields: ['evidence'] },
      'archive.json': { statuses: ['cancelled', 'deleted'] }, 'other.json': { statuses: ['todo'] } },
    groups: { Active: ['todo', 'doing'], Done: ['finished'], Archive: ['cancelled', 'deleted'] }, working_statuses: ['doing'],
  });
  writeStore(root, 'done.json', []);
  writeStore(root, 'archive.json', []);
  writeStore(root, 'other.json', []);
  rejected(root, () => transitionTask(root, 1, 'finished', {}), 'INVALID_STORE');
  const archived = deleteTask(root, 1, { status: 'cancelled' });
  assert.equal(archived.extension, 7);
  rejected(root, () => transitionTask(root, 1, 'todo', {}), 'INVALID_INPUT');
  assert.equal(transitionTask(root, 1, 'todo', { store: 'other' }).id, 1);
  assert.equal(transitionTask(root, 1, 'doing', {}).status, 'doing');
  rejected(root, () => deleteTask(root, 1, { status: 'deleted', ifUpdatedAt: archived.updated_at }), 'TRANSITION_CONFLICT');
  rejected(root, () => deleteTask(root, 1, { status: 'finished' }), 'INVALID_INPUT');
});

test('reactivation checks cycles and working blockers against the resulting Active graph', (t) => {
  const root = fixture(t, [task(1, { blockers: [99] })]);
  writeStore(root, 'done.json', [task(99, { status: 'done', blockers: [1] })]);
  rejected(root, () => transitionTask(root, 99, 'pending', {}), 'INVALID_STORE');
  rejected(root, () => transitionTask(root, 99, 'review', {}), 'ACTIVE_BLOCKERS');
  transitionTask(root, 1, 'done', {});
  assert.equal(transitionTask(root, 99, 'in_progress', {}).status, 'in_progress');
  rejected(root, () => transitionTask(root, 1, 'pending', {}), 'INVALID_STORE');
});

test('invalid source, missing destinations, stale status and oversized output leave bytes unchanged', (t) => {
  const root = fixture(t, [task(1)]);
  rejected(root, () => transitionTask(root, 1, 'done', { from: 'pending' }), 'INVALID_INPUT');
  rejected(root, () => transitionTask(root, 1, 'done', { ifUpdatedAt: '2000-01-01T00:00:00.000Z' }), 'TRANSITION_CONFLICT');
  rejected(root, () => transitionTask(root, 55, 'done', {}), 'TASK_NOT_FOUND');
  writeStore(root, 'done.json', [task(99, { status: 'done', priority: 'wrong' })]);
  rejected(root, () => transitionTask(root, 1, 'done', {}), 'INVALID_STORE');
  writeStore(root, 'done.json', []);
  writeStore(root, 'active.json', [task(1, { description: 'x'.repeat(33000) })]);
  rejected(root, () => transitionTask(root, 1, 'done', {}), 'OUTPUT_TOO_LARGE');
});

test('interrupted cross-file moves block reads and recover through validator or creator without duplicates', async (t) => {
  for (const boundary of ['done.json', 'active.json', '.task-tracker.json']) {
    const previous = '2000-01-01T00:00:00.000Z';
    const root = fixture(t, [task(1, { custom: 'retained', updated_at: previous })]);
    const preload = interruption(root, `String(args[1]).endsWith('/${boundary}')`);
    const result = await launch(root, ['1', '--status', 'done', '--if-updated-at', previous], preload).complete;
    assert.equal(result.code, 73);
    assert.equal(result.signal, null);
    const journal = JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.pending')));
    const staged = journal.writes.find((write) => write.path === 'tasks/done.json').staged;
    const savedPath = existsSync(join(root, staged)) ? staged : 'tasks/done.json';
    const saved = JSON.parse(readFileSync(join(root, savedPath))).find((record) => record.id === 1);
    for (const read of [() => getTask(root, 1), () => inspectBlockers(root, 1)]) assert.throws(read, { code: 'RECOVERY_REQUIRED' });
    if (boundary === 'active.json') assert.equal(createTask(root, { title: 'After recovery' }).id, 100);
    else validateProject(root);
    const retained = JSON.parse(readFileSync(join(root, 'tasks/done.json'))).filter((value) => value.id === 1);
    assert.deepEqual(retained, [task(1, { status: 'done', custom: 'retained', updated_at: retained[0].updated_at })]);
    assert.equal(retained[0].updated_at, saved.updated_at);
    assert.equal(new Date(retained[0].updated_at).toISOString(), retained[0].updated_at);
    assert.equal(JSON.parse(readFileSync(join(root, 'tasks/active.json'))).some((value) => value.id === 1), false);
    assert.equal(validateProject(root).refreshed, false);
    rejected(root, () => transitionTask(root, 1, 'done', { ifUpdatedAt: '2000-01-01T00:00:00.000Z' }), 'TRANSITION_CONFLICT');
  }
});

test('legacy and explicit in-tasks schemas survive interrupted lifecycle recovery', async (t) => {
  const config = {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    groups: { Active: ['pending'], Done: ['done'] },
  };
  for (const selected of ['legacy', 'explicit']) {
    const root = fixture(t, [task(1)], selected === 'legacy' ? config : undefined);
    const schemaPath = selected === 'explicit' ? 'tasks/custom-schema.json' : undefined;
    if (schemaPath) writeFileSync(join(root, schemaPath), JSON.stringify(config));
    const preload = interruption(root, "String(args[1]).endsWith('/done.json')");
    const args = ['1', '--status', 'done', ...(schemaPath ? ['--schema-path', schemaPath] : [])];
    assert.equal((await launch(root, args, preload).complete).code, 73);
    validateProject(root, { schemaPath });
    assert.equal(getTask(root, 1, { stores: ['all'], schemaPath }).status, 'done');
  }
});

test('recovery refuses external edits and malformed journal paths without overwriting them', async (t) => {
  const root = fixture(t, [task(1)]);
  const preload = interruption(root, "String(args[1]).endsWith('/done.json')");
  assert.equal((await launch(root, ['1', '--status', 'done'], preload).complete).code, 73);
  const path = join(root, 'tasks/active.json');
  const original = readFileSync(path);
  writeStore(root, 'active.json', [task(1, { external: true })]);
  rejected(root, () => validateProject(root), 'RECOVERY_CONFLICT');
  writeFileSync(path, original);
  const journalPath = join(root, 'tasks/.task-tracker.pending');
  const journal = readFileSync(journalPath);
  const malformed = JSON.parse(journal);
  malformed.writes[0].path = '../outside.json';
  writeFileSync(journalPath, JSON.stringify(malformed));
  rejected(root, () => validateProject(root), 'INVALID_SERVICE');
  writeFileSync(journalPath, journal);
  validateProject(root);
  assert.equal(getTask(root, 1, { stores: ['all'] }).status, 'done');
});

test('cooperating concurrent transitions serialize and reject a stale timestamp', async (t) => {
  const updated_at = '2000-01-01T00:00:00.000Z';
  const root = fixture(t, [task(1, { updated_at }), task(2)]);
  const runs = [launch(root, ['1', '--status', 'done', '--if-updated-at', updated_at]), launch(root, ['1', '--status', 'review', '--if-updated-at', updated_at]), launch(root, ['2', '--status', 'done'])];
  const results = await Promise.all(runs.map((entry) => entry.complete));
  assert.equal(results[2].code, 0, results[2].stderr);
  assert.deepEqual(results.slice(0, 2).map((entry) => entry.code).sort(), [0, 1]);
  assert.match(results.find((entry) => entry.code === 1).stderr, /TRANSITION_CONFLICT/);
  assert.equal(validateProject(root).refreshed, false);
});

test('certified transitions avoid parsing unrelated history and refresh after manual edits', (t) => {
  const root = fixture(t, [task(1)]);
  writeStore(root, 'archive.json', [task(200, { status: 'cancelled', marker: 'HISTORY_PARSE_SENTINEL' })]);
  validateProject(root);
  const parse = JSON.parse;
  let historyParses = 0;
  JSON.parse = (source, ...args) => {
    if (String(source).includes('HISTORY_PARSE_SENTINEL')) historyParses++;
    return parse(source, ...args);
  };
  try { transitionTask(root, 1, 'done', {}); } finally { JSON.parse = parse; }
  assert.equal(historyParses, 0);
  assert.equal(state(root).counter, 200);
  writeStore(root, 'archive.json', [task(250, { status: 'cancelled' })]);
  transitionTask(root, 1, 'pending', {});
  assert.equal(state(root).counter, 250);
  assert.equal(validateProject(root).refreshed, false);
});

test('a failed replacement leaves a recoverable pending move and no successful response', (t) => {
  const root = fixture(t, [task(1)]);
  const preload = join(root, 'failure.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.renameSync;
fs.renameSync = (...args) => {
  if (String(args[1]).endsWith('/active.json')) throw Object.assign(new Error('injected'), { code: 'EIO' });
  return rename(...args);
};
syncBuiltinESMExports();\n`);
  const result = run('transition-task', [root, '1', '--status', 'done'], { env: { ...process.env, NODE_OPTIONS: `--import=${preload}` } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /WRITE_INCOMPLETE/);
  assert.equal(run('list-tasks', [root]).status, 1);
  const recovered = run('validate-task-stores', [root]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(getTask(root, 1, { stores: ['all'] }).status, 'done');
  assert.equal(validateProject(root).refreshed, false);
});

test('recovery accepts temporary duplicate bytes at the project input boundary', async (t) => {
  const root = fixture(t, [task(1, { custom: 'x'.repeat(400) }), task(2, { padding: '' })]);
  writeStore(root, 'done.json', []);
  const path = join(root, 'tasks/active.json');
  const records = JSON.parse(readFileSync(path));
  const currentBytes = readFileSync(path).length + readFileSync(join(root, 'tasks/done.json')).length;
  records[1].padding = 'x'.repeat(projectBytes - currentBytes - 100);
  writeStore(root, 'active.json', records);
  const preload = interruption(root, "String(args[1]).endsWith('/done.json')");
  assert.equal((await launch(root, ['1', '--status', 'done'], preload).complete).code, 73);
  assert.ok(readFileSync(path).length + readFileSync(join(root, 'tasks/done.json')).length > projectBytes);
  assert.equal(validateProject(root).tasks, 2);
  assert.equal(getTask(root, 1, { stores: ['done'] }).status, 'done');
});

test('reads reject a move published while task bytes are being read', (t) => {
  const root = fixture(t, [task(1)]);
  const preload = join(root, 'read-interruption.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
const open = fs.openSync;
fs.openSync = (...args) => {
  if (String(args[0]).endsWith('/active.json')) fs.writeFileSync(join(dirname(args[0]), '.task-tracker.pending'), '{}');
  return open(...args);
};
syncBuiltinESMExports();\n`);
  const result = run('list-tasks', [root], { env: { ...process.env, NODE_OPTIONS: `--import=${preload}` } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /RECOVERY_REQUIRED/);
});

test('transitions preserve shadowed duplicate status values and edit only the effective string', (t) => {
  for (const [shadow, key] of [
    ['{"legacy":true,"status":"nested"}', '"status"'],
    ['["legacy",{"status":"nested"}]', '"status"'],
    ['{"legacy":[true]}', '"sta\\u0074us"'],
  ]) {
    const root = fixture(t, []);
    const original = `{"id":1,"title":"Task","status":${shadow},${key}:"pending"}`;
    writeFileSync(join(root, 'tasks/active.json'), `[${original}]\n`);
    assert.equal(validateProject(root).valid, true);
    for (const [from, status, file] of [
      ['pending', 'in_progress', 'active.json'],
      ['in_progress', 'done', 'done.json'],
      ['done', 'pending', 'active.json'],
    ]) {
      assert.equal(transitionTask(root, 1, status, {}).status, status);
      assert.equal(getTask(root, 1, { stores: ['all'] }).status, status);
      assert.ok(readFileSync(join(root, 'tasks', file), 'utf8').includes(original.replace(`${key}:"pending"`, `${key}:"${status}"`).slice(0, -1)));
      assert.equal(validateProject(root).refreshed, false);
      assert.equal(Object.hasOwn(snapshot(root), '.task-tracker.pending'), false);
    }
  }
});
