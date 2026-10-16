import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixture, snapshot, task, writeStore } from './fixtures.mjs';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const installer = fileURLToPath(new URL('../scripts/install-cli.mjs', import.meta.url));
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, ...options });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}
function cli(root, args, options) { return execute(process.execPath, [entry, ...args], { cwd: root, ...options }); }
function success(result) { assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return result.stdout; }
function json(result) { return JSON.parse(success(result)); }
function rejected(root, args, code, options) {
  const before = snapshot(root);
  const result = cli(root, args, options);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}:`));
  assert.deepEqual(snapshot(root), before);
}

test('installed CLI handles field rules, full lifecycle and readable diffs without staging', (t) => {
  const root = fixture(t, [], { fields: {
    acceptance: { type: 'array', required: true, min_items: 1, items: 'string', non_empty_items: true },
  }, stores: {
    'active.json': { statuses: ['pending', 'in_progress', 'review'] },
    'done.json': { statuses: ['done'] }, 'archive.json': { statuses: ['cancelled'] },
  } });
  writeStore(root, 'done.json', []);
  writeStore(root, 'archive.json', []);
  const bin = join(root, 'bin');
  const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}` };
  success(execute(process.execPath, [installer, 'install', '--bin-dir', bin], { env }));
  const installed = (args, input) => execute(join(bin, 'tasks'), args, { cwd: root, env, input });
  const git = (...args) => success(execute('git', args, { cwd: root }));
  git('init', '-q');
  git('add', 'tasks', 'docs');
  const index = readFileSync(join(root, '.git/index'));
  rejected(root, ['create', '--title', 'Missing acceptance'], 'INVALID_STORE');
  rejected(root, ['create', '--title', 'Blank acceptance', '--input', '-'], 'INVALID_STORE', { input: '{"acceptance":[""]}' });
  const created = json(installed(['create', '--title', 'Implement', '--priority', 'high', '--input', '-'], '{"acceptance":["CLI lifecycle"],"extension":{"keep":true}}'));
  const id = String(created.id);
  assert.equal(created.priority, 'high');
  assert.deepEqual(json(installed(['get', id, '--format', 'json'])), created);
  const changed = json(installed(['update', id, '--title', 'Implement carefully', '--input', '-'], '{"set":{"scope":"Whole text"}}'));
  assert.equal(changed.scope, 'Whole text');
  assert.deepEqual(changed.extension, { keep: true });
  const diff = git('diff', '--', 'tasks/active.json');
  assert.match(diff, /\+    "title": "Implement carefully"/);
  assert.doesNotMatch(diff, /\+\[\{/);
  assert.equal(json(installed(['transition', id, '--status', 'in_progress'])).status, 'in_progress');
  assert.equal(json(installed(['transition', id, '--status', 'done'])).status, 'done');
  assert.equal(json(installed(['get', id, '--group', 'Done', '--format', 'json'])).id, created.id);
  assert.equal(json(installed(['transition', id, '--status', 'cancelled'])).status, 'cancelled');
  assert.equal(json(installed(['transition', id, '--status', 'pending'])).status, 'pending');
  assert.equal(json(installed(['update', id, '--status', 'cancelled'])).status, 'cancelled');
  assert.equal(json(installed(['update', id, '--status', 'pending'])).status, 'pending');
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(execute('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root }).status, 128);
  success(execute(process.execPath, [installer, 'uninstall', '--bin-dir', bin], { env }));
});

test('field flags and JSON share patch validation, full no-op responses and stale conflicts', (t) => {
  const root = fixture(t, [task(1, { blockers: [2, 500], items: [{ a: 1, b: 2 }], optional: true }), task(2)]);
  for (const args of [['transition', '1', '--status', 'in_progress'], ['update', '1', '--status', 'in_progress'], ['update', '1', '--json', '{"set":{"status":"in_progress"}}']]) {
    rejected(root, args, 'ACTIVE_BLOCKERS');
  }
  const first = json(cli(root, ['update', '1', '--title', 'Changed', '--json', '{"set":{"settings":{"new":true}},"add":{"items":["new","new"]},"unset":["optional"]}']));
  assert.deepEqual(first.items, [{ a: 1, b: 2 }, 'new']);
  assert.equal('optional' in first, false);
  const before = snapshot(root);
  assert.deepEqual(json(cli(root, ['update', '1', '--json', '{"add":{"items":[{"b":2,"a":1},"new"]}}'])), first);
  assert.deepEqual(snapshot(root), before);
  const updated = json(cli(root, ['update', '1', '--status', 'in_progress', '--input', '-'], { input: '{"remove":{"blockers":[2]},"set":{"items":["replacement"]}}' }));
  assert.deepEqual(updated.blockers, [500]);
  assert.deepEqual(updated.items, ['replacement']);
  rejected(root, ['update', '1', '--title', 'Stale', '--if-updated-at', first.updated_at], 'TRANSITION_CONFLICT');
  rejected(root, ['update', '1', '--json', '{}', '--if-updated-at', first.updated_at], 'TRANSITION_CONFLICT');
  assert.deepEqual(json(cli(root, ['update', '1', '--blockers', ''])).blockers, []);
  for (const patch of [{ set: { blockers: [] } }, { add: { blockers: [] } }, { remove: { blockers: [] } }, { unset: ['blockers'] }]) {
    rejected(root, ['update', '1', '--blockers', '', '--json', JSON.stringify(patch)], 'INVALID_INPUT');
  }
  rejected(root, ['create', '--title', 'Flag', '--json', '{"title":"JSON"}'], 'INVALID_INPUT');
  rejected(root, ['update', '1', '--title', 'A', '--title', 'B'], 'INVALID_INPUT');
  rejected(root, ['create', '--json', '{}', '--input', '-'], 'INVALID_INPUT');
  rejected(root, ['update', '1', '--title', 'X', '--json', '{"set":null}'], 'INVALID_INPUT');
  rejected(root, ['create', '--title', 'X', '--blockers', '1,no'], 'INVALID_INPUT');
  rejected(root, ['update', '1', '--json', '{"unset":["title"]}'], 'INVALID_STORE');
  rejected(root, ['create', '--input', '-'], 'INVALID_JSON', { input: '{' });
});

test('write selection, custom transitions and external validation use CLI contracts', (t) => {
  const root = fixture(t, [], {
    stores: { 'active.json': { statuses: ['todo', 'doing'] }, 'done.json': { statuses: ['finished'], required_fields: ['evidence'] } },
    groups: { Active: ['todo', 'doing'], Done: ['finished'] }, default_status: 'todo', working_statuses: ['doing'],
  });
  writeStore(root, 'done.json', []);
  const registry = join(root, 'registry.json');
  writeFileSync(registry, JSON.stringify({ projects: { selected: root } }));
  const created = json(cli(root, ['create', '--project', 'selected', '--config', registry, '--title', 'Custom']));
  const id = String(created.id);
  rejected(root, ['transition', id, '--status', 'in_progress'], 'INVALID_INPUT');
  assert.equal(json(cli(root, ['transition', '--project-path', root, id, '--status', 'doing'])).status, 'doing');
  rejected(root, ['update', id, '--status', 'finished'], 'INVALID_STORE');
  const patch = join(root, 'patch.json');
  writeFileSync(patch, '{"set":{"evidence":["passed"]}}');
  assert.equal(json(cli(root, ['update', root, id, '--status', 'finished', '--input', patch])).status, 'finished');
  for (const name of ['create', 'update', 'transition']) {
    const help = success(cli(root, [name, '--help']));
    assert.match(help, new RegExp(`Usage: tasks ${name}`));
    assert.match(help, /--project-path/);
    rejected(root, [name, ...(name === 'create' ? [] : [id]), '--project-path', root, '--project', 'selected'], 'INVALID_INPUT');
  }
  writeStore(root, 'done.json', [{ ...created, status: 'finished' }]);
  rejected(root, ['create', '--title', 'After invalid manual edit'], 'INVALID_STORE');
});

test('concurrent CLI writers allocate unique IDs and preserve independent patches', async (t) => {
  const root = fixture(t, [task(1, { items: [] })]);
  const launch = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => { assert.equal(signal, null); resolve({ status, stdout, stderr }); });
  });
  const results = await Promise.all(['A', 'B', 'C'].flatMap((title) => [
    launch(['create', '--title', title]),
    launch(['update', '1', '--json', JSON.stringify({ add: { items: [title] } })]),
  ]));
  const records = results.map(json);
  assert.equal(new Set(records.filter((_, index) => index % 2 === 0).map((record) => record.id)).size, 3);
  const current = json(cli(root, ['get', '1', '--format', 'json']));
  assert.deepEqual(current.items.sort(), ['A', 'B', 'C']);
  assert.equal(current.title, 'Task 1');
  json(cli(root, ['validate', '--format', 'json']));
});
