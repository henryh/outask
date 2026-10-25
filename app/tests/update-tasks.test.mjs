import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { updateTask } from '../src/update.mjs';
import { createTask } from '../src/create.mjs';
import { transitionTask } from '../src/transition.mjs';
import { fixture, task, snapshot, run } from './fixtures.mjs';

test('persisted collection edits are readable while untouched source and no-ops survive', (t) => {
  const root = fixture(t, []);
  const path = join(root, 'tasks/active.json');
  const neighbor = '{"id":2e0,"title":"Neighbor","status":"pending","number":1.2300}';
  const retained = '"extension":{"escaped":"\\u0041","number":1e+03,"items":[1,2]}';
  writeFileSync(path, `[\n  {\n    "id": 1,\n    "title": "Task",\n    "status": "pending",\n    ${retained},\n    "items": ["old"],\n    "settings": {"old":true}\n  },\n  ${neighbor}\n]\n`);
  const result = updateTask(root, 1, {
    add: { items: ['new'] },
    set: { settings: { nested: [1, { ok: true }], empty: {} }, added: ['line\nbreak', []] },
  });
  const source = readFileSync(path, 'utf8');
  assert.ok(source.includes('"items": [\n      "old",\n      "new"\n    ]'));
  assert.ok(source.includes('"settings": {\n      "nested": [\n        1,\n        {\n          "ok": true\n        }\n      ],\n      "empty": {}\n    }'));
  assert.ok(source.includes('"added": [\n      "line\\nbreak",\n      []\n    ]'));
  assert.ok(source.includes(retained));
  assert.ok(source.includes(neighbor));
  assert.ok(source.endsWith('\n]\n'));
  assert.deepEqual(JSON.parse(source)[0], result);
  const before = snapshot(root);
  assert.deepEqual(updateTask(root, 1, { set: { settings: { empty: {}, nested: [1, { ok: true }] } }, add: { items: ['new'] } }), result);
  assert.deepEqual(snapshot(root), before);
  updateTask(root, 1, { remove: { items: ['old'] }, set: { settings: {}, added: [] } });
  const emptied = readFileSync(path, 'utf8');
  assert.ok(emptied.includes('"items": [\n      "new"\n    ]'));
  assert.ok(emptied.includes('"settings": {}'));
  assert.ok(emptied.includes('"added": []'));
});

test('creation and lifecycle transfer retain readable nested collections and store boundaries', (t) => {
  const root = fixture(t, []);
  const created = createTask(root, { title: 'Created', details: { list: ['one', { two: [] }] } });
  const activePath = join(root, 'tasks/active.json');
  const active = readFileSync(activePath, 'utf8');
  assert.ok(active.includes('    "details": {\n      "list": [\n        "one",\n        {\n          "two": []\n        }\n      ]\n    }'));
  assert.ok(active.endsWith('\n  }\n]\n'));
  const moved = updateTask(root, created.id, { set: { status: 'done', evidence: [{ checks: ['passed'] }] } });
  const donePath = join(root, 'tasks/done.json');
  const done = readFileSync(donePath, 'utf8');
  assert.ok(done.includes('    "evidence": [\n      {\n        "checks": [\n          "passed"\n        ]\n      }\n    ]'));
  assert.deepEqual(JSON.parse(done).find((row) => row.id === created.id), moved);
  assert.ok(done.endsWith('\n  }\n]\n'));
  transitionTask(root, created.id, 'pending');
  assert.ok(readFileSync(activePath, 'utf8').includes('    "evidence": [\n      {\n        "checks": [\n          "passed"\n        ]\n      }\n    ]'));
});

test('writes separate compact store endings without rewriting equal fields or neighboring records', (t) => {
  const root = fixture(t, []);
  const path = join(root, 'tasks/active.json');
  const equal = '"equal":{"a":1e0,"b":[2,3]}';
  const multiline = '"multiline": {\n      "kept": [1,2]\n    }';
  const neighbor = '{"id":2,"title":"Other","status":"pending"}';
  writeFileSync(path, `[{"id":1,"title":"Task","status":"pending",${equal},${multiline}},${neighbor}]`);
  const unchanged = snapshot(root);
  updateTask(root, 1, { set: { equal: { b: [2, 3], a: 1 } } });
  assert.deepEqual(snapshot(root), unchanged);
  updateTask(root, 1, { set: { equal: { b: [2, 3], a: 1 }, added: [true] } });
  const changed = readFileSync(path, 'utf8');
  assert.ok(changed.includes(equal));
  assert.ok(changed.includes(multiline));
  assert.ok(changed.includes(neighbor));
  assert.ok(changed.endsWith(`${neighbor}\n]\n`));
  writeFileSync(join(root, 'tasks/done.json'), '[]');
  updateTask(root, 1, { set: { status: 'done', evidence: [{ passed: true }] } });
  const moved = readFileSync(join(root, 'tasks/done.json'), 'utf8');
  assert.ok(moved.includes('    "evidence": [\n      {\n        "passed": true\n      }\n    ]'));
  assert.ok(moved.endsWith('\n]\n'));
  assert.ok(readFileSync(path, 'utf8').endsWith('\n]\n'));
  writeFileSync(path, `[${neighbor}]`);
  createTask(root, { title: 'Append', list: [1] });
  assert.ok(readFileSync(path, 'utf8').endsWith('\n  }\n]\n'));
});

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
  assert.match(readFileSync(join(root, 'tasks/active.json'), 'utf8'), /"value":\{"old":1\},"value":\{\n/);
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
