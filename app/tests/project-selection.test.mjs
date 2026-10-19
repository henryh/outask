import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const commands = [
  ['list-tasks', []], ['get-task', ['1']], ['get-tasks', ['--id', '1']], ['inspect-blockers', ['1']],
  ['validate-task-stores', []], ['create-task', ['--json', '{"title":"New task"}']],
];

function jsonResult(name, args, cwd) {
  const result = run(name, [...args, '--format', 'json'], { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('read commands default to cwd and explicit paths select only the requested project', (t) => {
  const current = fixture(t, [task(1, { title: 'Current', blockers: [2] }), task(2)]);
  const selected = fixture(t, [task(1, { title: 'Selected', blockers: [3] }), task(3), task(4)]);
  writeStore(current, '.task-tracker.json', { note: 'readers must preserve this' });
  const beforeCurrent = snapshot(current);
  const beforeSelected = snapshot(selected);
  for (const [project, prefix, ids, title, blocker] of [
    [current, [], [1, 2], 'Current', 2],
    [selected, [selected], [1, 3, 4], 'Selected', 3],
  ]) {
    const page = jsonResult('list-tasks', prefix, current);
    assert.deepEqual(page.tasks.map((record) => record.id), ids);
    assert.equal(jsonResult('list-tasks', [...prefix, '--count'], current), ids.length);
    assert.equal(jsonResult('get-task', [...prefix, '1'], current).title, title);
    assert.equal(jsonResult('get-tasks', [...prefix, '--id', '1'], current).tasks[0].title, title);
    assert.deepEqual(jsonResult('inspect-blockers', [...prefix, '1'], current).activeBlockers, [blocker]);
    assert.deepEqual(snapshot(project), project === current ? beforeCurrent : beforeSelected);
  }
  assert.deepEqual(snapshot(current), beforeCurrent);
  assert.deepEqual(snapshot(selected), beforeSelected);
});

test('validation defaults to cwd and an explicit project refreshes only that service state', (t) => {
  const current = fixture(t, [task(1)]);
  const selected = fixture(t, [task(800)]);
  const beforeCurrent = snapshot(current);
  const beforeSelected = snapshot(selected);
  assert.equal(jsonResult('validate-task-stores', [], current).counter, 99);
  const afterCurrent = snapshot(current);
  for (const [name, bytes] of Object.entries(beforeCurrent)) if (name !== '.task-tracker.json') assert.deepEqual(afterCurrent[name], bytes);
  assert.ok(afterCurrent['.task-tracker.json']);
  assert.deepEqual(snapshot(selected), beforeSelected);
  assert.equal(jsonResult('validate-task-stores', [selected], current).counter, 800);
  for (const [name, bytes] of Object.entries(beforeSelected)) {
    if (name !== '.task-tracker.json') assert.deepEqual(readFileSync(join(selected, 'tasks', name)), bytes);
  }
  assert.deepEqual(snapshot(current), afterCurrent);
});

test('one detail positional is always an ID even when a numeric directory exists', (t) => {
  const current = fixture(t, [task(123, { title: 'Current ID', blockers: [2] }), task(2)]);
  const numeric = join(current, '123');
  mkdirSync(join(numeric, 'tasks'), { recursive: true });
  writeStore(numeric, 'active.json', [task(9, { title: 'Numeric directory' })]);
  const beforeCurrent = snapshot(current);
  const beforeNumeric = snapshot(numeric);
  assert.equal(jsonResult('get-task', ['123'], current).title, 'Current ID');
  assert.deepEqual(jsonResult('inspect-blockers', ['123'], current).activeBlockers, [2]);
  assert.equal(jsonResult('get-task', ['123', '9'], current).title, 'Numeric directory');
  assert.deepEqual(jsonResult('inspect-blockers', ['123', '9'], current).activeBlockers, []);
  assert.deepEqual(snapshot(current), beforeCurrent);
  assert.deepEqual(snapshot(numeric), { ...beforeNumeric, '.task-tracker.json': Buffer.from('{}\n') });
});

test('fresh reads prepare only the selected service state; creation prepares Active', (t) => {
  const parent = fixture(t, [task(1)]);
  const before = snapshot(parent);
  for (const [name, args] of commands) {
    for (const explicit of [false, true]) {
      const empty = join(parent, `${name}-${explicit}`);
      mkdirSync(empty);
      const prefix = explicit ? [empty] : [];
      const cwd = explicit ? parent : empty;
      const result = run(name, [...prefix, ...args, '--format', 'json'], { cwd });
      const succeeds = ['list-tasks', 'get-tasks', 'create-task'].includes(name);
      assert.equal(result.status, succeeds ? 0 : 1, result.stderr);
      if (succeeds) {
        assert.equal(result.stderr, '');
        const data = JSON.parse(result.stdout);
        if (name === 'create-task') {
          assert.equal(data.id, 1);
          assert.equal(data.title, 'New task');
        } else {
          assert.deepEqual(data.tasks, []);
          assert.equal(data.hasMore, false);
          if (name === 'get-tasks') assert.deepEqual(data.not_found, [1]);
          else {
            assert.equal(data.total, 0);
            assert.equal(jsonResult(name, [...prefix, '--count'], cwd), 0);
          }
        }
      } else {
        assert.equal(result.stdout, '');
        assert.match(result.stderr, name === 'validate-task-stores' ? /^READ_ERROR:/ : /^TASK_NOT_FOUND:/);
        if (name === 'validate-task-stores') assert.ok(result.stderr.includes(join(empty, 'tasks')), result.stderr);
      }
      assert.deepEqual(readdirSync(empty), ['tasks']);
      assert.deepEqual(readdirSync(join(empty, 'tasks')).sort(), name === 'create-task'
        ? ['.task-tracker.json', 'active.json'] : ['.task-tracker.json']);
      if (name !== 'create-task') assert.deepEqual(JSON.parse(readFileSync(join(empty, 'tasks/.task-tracker.json'))), {});
      assert.deepEqual(snapshot(parent), before);
    }
  }
});

test('all command help and positional errors describe the shared project contract', (t) => {
  const root = fixture(t, [task(1)]);
  const before = snapshot(root);
  for (const [name, args] of commands) {
    const help = run(name, ['--help'], { cwd: root });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /\[project-path\]/);
    assert.match(help.stdout, /current working directory/);
    assert.match(help.stdout, /no other directories are searched/);
    const invalid = run(name, [root, root, ...args], { cwd: root });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /^INVALID_INPUT:/);
  }
  for (const name of ['get-task', 'inspect-blockers']) {
    for (const args of [[], ['not-an-id']]) {
      const result = run(name, args, { cwd: root });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^INVALID_INPUT:/);
    }
  }
  assert.deepEqual(snapshot(root), before);
});
