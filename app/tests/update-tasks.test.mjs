import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { updateTask } from '../src/update.mjs';
import { fixture, task, snapshot, run } from './fixtures.mjs';

test('partial replacements, structural array equality and removals preserve untouched source', (t) => {
  const root = fixture(t, [task(1, { extension: { untouched: true }, settings: { old: true }, items: [{ a: 1, b: 2 }, 'x', 'x'], optional: 1 }), task(2)]);
  const path = join(root, 'tasks/active.json');
  writeFileSync(path, readFileSync(path, 'utf8').replace('"id": 2', '"id": 2e0'));
  const result = updateTask(root, 1, { set: { title: 'Edited\ntext', settings: { new: true } }, add: { items: [{ b: 2, a: 1 }, 'y', 'y'] }, unset: ['optional', 'absent'] });
  assert.deepEqual(result.settings, { new: true });
  assert.deepEqual(result.extension, { untouched: true });
  assert.deepEqual(result.items, [{ a: 1, b: 2 }, 'x', 'x', 'y']);
  assert.equal('optional' in result, false);
  assert.match(readFileSync(path, 'utf8'), /"id": 2e0/);
  const before = snapshot(root);
  assert.deepEqual(updateTask(root, 1, { add: { items: [{ b: 2, a: 1 }, 'y'] }, unset: ['absent'] }), result);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(updateTask(root, 1, { remove: { items: ['x', 'missing'] } }).items, [{ a: 1, b: 2 }, 'y']);
  assert.deepEqual(updateTask(root, 1, { set: { items: [] } }).items, []);
});

test('invalid patches and combined final records leave all bytes unchanged', (t) => {
  const root = fixture(t, [task(1, { blockers: [2, 500] }), task(2, { blockers: [] })]);
  for (const patch of [{ unset: ['title'] }, { set: { id: 1 } }, { unset: ['updated_at'] }, { set: { title: 'x' }, unset: ['title'] }, { add: { title: ['x'] } }, { set: { status: 'in_progress' } }, { set: { blockers: [1] } }]) {
    const before = snapshot(root);
    assert.throws(() => updateTask(root, 1, patch));
    assert.deepEqual(snapshot(root), before);
  }
  assert.throws(() => updateTask(root, 2, { add: { blockers: [1] } }), /cycle/);
  const started = updateTask(root, 1, { set: { status: 'in_progress' }, remove: { blockers: [2] } });
  assert.deepEqual(started.blockers, [500]);
  const done = updateTask(root, 1, { set: { status: 'done', note: { final: true } } });
  assert.equal(done.status, 'done');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks/done.json'))).find((row) => row.id === 1), done);
  assert.equal(updateTask(root, 1, { set: { status: 'pending' } }).status, 'pending');
});

test('scripts accept inline, file and stdin patches with current-directory selection', (t) => {
  const root = fixture(t, [task(1)]);
  const inline = run('update-task', ['1', '--json', '{"set":{"title":"inline"}}'], { cwd: root });
  assert.equal(inline.status, 0, inline.stderr);
  assert.equal(JSON.parse(inline.stdout).title, 'inline');
  const path = join(root, 'patch.json');
  writeFileSync(path, '{"set":{"title":"file"}}');
  assert.equal(run('update-task', [root, '1', '--input', path]).status, 0);
  const stdin = run('update-task', [root, '1', '--input', '-'], { input: '{"set":{"title":"stdin"}}' });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(JSON.parse(stdin.stdout).title, 'stdin');
  assert.equal(run('update-task', [root, '1', '--json', '{}', '--input', '-']).status, 1);
});

test('stale no-ops fail and concurrent additions cannot lose updates', async (t) => {
  const root = fixture(t, [task(1, { items: [] })]);
  const first = updateTask(root, 1, { add: { items: ['first'] } });
  updateTask(root, 1, { add: { items: ['second'] } });
  assert.throws(() => updateTask(root, 1, { add: { items: ['first'] } }, { ifUpdatedAt: first.updated_at }), { code: 'TRANSITION_CONFLICT' });
  const script = fileURLToPath(new URL('../scripts/update-task.mjs', import.meta.url));
  const results = await Promise.all(['a', 'b'].map((item) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, root, '1', '--json', JSON.stringify({ add: { items: [item] } })]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  })));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const final = updateTask(root, 1, {});
  assert.deepEqual(new Set(final.items), new Set(['first', 'second', 'a', 'b']));
});

test('object/array replacements and field removal handle duplicate keys safely', (t) => {
  const root = fixture(t, [task(1)]);
  writeFileSync(join(root, 'tasks/active.json'), '[{"id":1 , "title":"t","status":"pending","extension":{"keep":[1,2]},"value":{"old":1},"value":[2],"drop":1,"drop":2}]\n');
  const result = updateTask(root, 1, { set: { value: { nested: [1, 2] } }, unset: ['drop'] });
  assert.deepEqual(result.value, { nested: [1, 2] });
  const persisted = JSON.parse(readFileSync(join(root, 'tasks/active.json')))[0];
  assert.deepEqual(persisted, result);
  assert.match(readFileSync(join(root, 'tasks/active.json'), 'utf8'), /"extension":\{"keep":\[1,2\]\}/);
});

test('combined content and status patches satisfy destination requirements atomically', (t) => {
  const root = fixture(t, [task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'], required_fields: ['evidence'] } },
    groups: { Active: ['pending'], Done: ['done'] },
  });
  // Existing destination records also need to satisfy the configured contract.
  writeFileSync(join(root, 'tasks/done.json'), '[]\n');
  const before = snapshot(root);
  assert.throws(() => updateTask(root, 1, { set: { status: 'done', title: 'Invalid move' } }), /evidence/);
  assert.deepEqual(snapshot(root), before);
  const result = updateTask(root, 1, { set: { status: 'done', evidence: ['Passed'] } });
  assert.equal(result.status, 'done');
  assert.deepEqual(result.evidence, ['Passed']);
});
