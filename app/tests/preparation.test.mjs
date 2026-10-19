import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { mutationProject, withDestination } from '../src/destinations.mjs';
import { openProject } from '../src/stores.mjs';
import { withProjectLock } from '../src/service.mjs';
import { projectLockPath } from '../src/project-lock.mjs';
import { createTask } from '../src/create.mjs';
import { countTasks, getTask, getTasks, listTasks } from '../src/tasks.mjs';
import { searchTasks } from '../src/search.mjs';
import { inspectBlockers } from '../src/blockers.mjs';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { updateTask } from '../src/update.mjs';
import { validateProject } from '../src/validation.mjs';
import { task, writeStore } from './fixtures.mjs';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const installer = fileURLToPath(new URL('../scripts/install-cli.mjs', import.meta.url));
function empty(t) {
  const root = mkdtempSync(join(tmpdir(), 'task-tracker-prepare-'));
  t.after(() => {
    rmSync(projectLockPath(root), { force: true });
    rmSync(`${projectLockPath(root)}-journal`, { force: true });
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function execute(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
const state = (root) => JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json')));

test('first core task reads return an empty project without creating records or schema', (t) => {
  for (const noCache of [false, true]) {
    for (const first of [listTasks, countTasks]) {
      const root = empty(t);
      const options = { noCache };
      const initial = first(root, options);
      if (first === countTasks) assert.equal(initial, 0);
      else assert.deepEqual(initial.tasks, []);
      for (let repeat = 0; repeat < 2; repeat++) {
        const page = listTasks(root, { ...options, group: 'Active', fields: ['id', 'title', 'status'], limit: 50 });
        assert.deepEqual(page.tasks, []);
        assert.equal(page.total, 0);
        assert.equal(page.hasMore, false);
        assert.equal(page.nextOffset, null);
        assert.equal(countTasks(root, options), 0);
        const search = searchTasks(root, 'anything', options);
        assert.deepEqual(search.tasks, []);
        assert.equal(search.hasMore, false);
        const batch = getTasks(root, [1, 2], options);
        assert.deepEqual(batch.tasks, []);
        assert.deepEqual(batch.not_found, [1, 2]);
        assert.throws(() => getTask(root, 1, options), { code: 'TASK_NOT_FOUND' });
      }
      assert.throws(() => listTasks(root, { ...options, limit: 100 }), { code: 'INVALID_INPUT' });
      assert.throws(() => listTasks(root, { ...options, stores: ['unknown'] }), { code: 'INVALID_INPUT' });
      for (const selector of [{ stores: ['active'] }, { stores: ['all'] }, { group: 'Done' }, { group: 'Archive' }]) {
        assert.deepEqual(listTasks(root, { ...options, ...selector }).tasks, []);
      }
      assert.deepEqual(readdirSync(root), ['tasks']);
      assert.deepEqual(readdirSync(join(root, 'tasks')), ['.task-tracker.json']);
      assert.deepEqual(state(root), {});
      const created = createTask(root, { title: 'First real task' });
      assert.equal(created.id, 1);
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks/active.json'))), [created]);
      assert.equal(countTasks(root, options), 1);
      assert.deepEqual(listTasks(root, options).tasks, [{ id: 1, title: 'First real task', status: 'pending' }]);
      assert.deepEqual(readdirSync(join(root, 'tasks')).sort(), ['.task-tracker.json', 'active.json']);
    }
  }
});

test('valid service metadata with no prior storage evidence leaves first reads empty and unchanged', (t) => {
  for (const service of [
    { counter: 0, extension: { keep: true } },
    { counter: 0, validated: { counter: 0, files: { 'tasks/task-schema.json': null }, extension: 'kept' } },
    { validated: { counter: 0, files: {} } },
  ]) {
    const root = empty(t);
    mkdirSync(join(root, 'tasks'));
    writeStore(root, '.task-tracker.json', service);
    const before = readFileSync(join(root, 'tasks/.task-tracker.json'));
    for (const noCache of [false, true]) {
      assert.equal(countTasks(root, { noCache }), 0);
      assert.deepEqual(listTasks(root, { noCache }).tasks, []);
    }
    assert.deepEqual(readdirSync(join(root, 'tasks')), ['.task-tracker.json']);
    assert.deepEqual(readFileSync(join(root, 'tasks/.task-tracker.json')), before);
  }
});

test('first failed mutations and validation prepare only uncertified service metadata', (t) => {
  for (const [operation, code] of [[(root) => inspectBlockers(root, 1), 'TASK_NOT_FOUND'], [validateProject, 'READ_ERROR'],
    [(root) => transitionTask(root, 1, 'done'), 'TASK_NOT_FOUND'], [(root) => deleteTask(root, 1), 'TASK_NOT_FOUND'],
    [(root) => updateTask(root, 1, { set: { title: 'Changed' } }), 'READ_ERROR']]) {
    const root = empty(t);
    assert.throws(() => operation(root), { code });
    assert.deepEqual(readdirSync(root), ['tasks']);
    assert.deepEqual(readdirSync(join(root, 'tasks')), ['.task-tracker.json']);
    assert.deepEqual(state(root), {});
  }
});

test('missing stores in configured, partial or previously populated projects remain errors', (t) => {
  const roots = [];
  const configured = empty(t);
  mkdirSync(join(configured, 'docs'));
  writeFileSync(join(configured, 'docs/task-schema.json'), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } } }));
  roots.push(configured);
  const partial = empty(t);
  mkdirSync(join(partial, 'tasks'));
  writeStore(partial, 'done.json', []);
  roots.push(partial);
  const deleted = empty(t);
  createTask(deleted, { title: 'Previously stored' });
  assert.equal(countTasks(deleted), 1);
  rmSync(join(deleted, 'tasks/active.json'));
  roots.push(deleted);
  for (const retained of [
    { counter: 1 },
    { validated: { counter: 1, files: { 'tasks/task-schema.json': null } } },
    { counter: 0, validated: { counter: 0, files: { 'tasks/task-schema.json': null, 'tasks/active.json': 'a'.repeat(64) } } },
    { validated: { counter: 0 } },
  ]) {
    const root = empty(t);
    mkdirSync(join(root, 'tasks'));
    writeStore(root, '.task-tracker.json', retained);
    roots.push(root);
  }
  for (const root of roots) {
    for (const noCache of [false, true]) {
      for (const operation of [listTasks, countTasks, (path, options) => getTask(path, 1, options),
        (path, options) => getTasks(path, [1], options), (path, options) => searchTasks(path, 'anything', options)]) {
        assert.throws(() => operation(root, { noCache }), { code: 'READ_ERROR' });
      }
    }
    assert.equal(existsSync(join(root, 'tasks/active.json')), false);
  }
});

test('malformed task data and pending recovery are never treated as a fresh project', (t) => {
  for (const [name, source, code] of [
    ['active.json', '[broken', 'INVALID_JSON'],
    ['active.json', '{}', 'INVALID_STORE'],
    ['.task-tracker.json', '[broken', 'INVALID_JSON'],
    ['.task-tracker.json', '[]', 'INVALID_SERVICE'],
    ['.task-tracker.pending', '{}', 'RECOVERY_REQUIRED'],
  ]) {
    const root = empty(t);
    mkdirSync(join(root, 'tasks'));
    writeStore(root, '.task-tracker.json', {});
    writeFileSync(join(root, 'tasks', name), source);
    for (const noCache of [false, true]) {
      assert.throws(() => listTasks(root, { noCache }), { code });
      assert.throws(() => countTasks(root, { noCache }), { code });
    }
    assert.equal(readFileSync(join(root, 'tasks', name), 'utf8'), source);
  }
});

test('installed CLI adopts an empty non-Git project without skill or configuration', (t) => {
  const root = empty(t);
  const bin = join(root, 'bin');
  const installed = execute(process.execPath, [installer, 'install', '--bin-dir', bin], root);
  assert.equal(installed.status, 0, installed.stderr);
  const project = join(root, 'project');
  mkdirSync(project);
  mkdirSync(join(project, 'AGENTS.md'));
  symlinkSync(join(project, 'missing-skill'), join(project, 'SKILL.md'));
  const cli = (...args) => {
    const result = execute(join(bin, 'tasks'), args, project);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  cli('create', '--title', 'First task');
  assert.equal(cli('list', '--format', 'ids'), '1\n');
  cli('update', '1', '--title', 'Completed', '--status', 'done');
  assert.equal(cli('list', '--group', 'Done', '--format', 'ids'), '1\n');
  cli('transition', '1', '--status', 'cancelled');
  assert.equal(cli('list', '--group', 'Archive', '--format', 'ids'), '1\n');
  assert.equal(JSON.parse(cli('validate', '--format', 'json')).counter, 1);
  assert.equal(existsSync(join(project, '.git')), false);
  assert.equal(existsSync(join(project, 'docs')), false);
  assert.deepEqual(readdirSync(join(project, 'tasks')).sort(), ['.task-tracker.json', 'active.json', 'archive.json', 'done.json']);
  const before = readFileSync(join(project, 'tasks/.task-tracker.json'));
  cli('get', '1', '--store', 'all');
  cli('list');
  assert.deepEqual(readFileSync(join(project, 'tasks/.task-tracker.json')), before);
});

test('standard destination files appear only when needed, including delete and combined updates', (t) => {
  for (const finish of [
    (root) => transitionTask(root, 1, 'done'),
    (root) => updateTask(root, 1, { set: { title: 'Finished', status: 'done' } }),
    (root) => deleteTask(root, 1),
  ]) {
    const root = empty(t);
    createTask(root, { title: 'New', extension: { keep: true } });
    assert.deepEqual(readdirSync(join(root, 'tasks')).sort(), ['.task-tracker.json', 'active.json']);
    const moved = finish(root);
    assert.deepEqual(moved.extension, { keep: true });
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks', moved.status === 'done' ? 'done.json' : 'archive.json'))), [moved]);
    assert.equal(validateProject(root).refreshed, false);
  }
});

test('history-only projects validate and allocate above retained IDs without rewriting history', (t) => {
  for (const name of ['done.json', 'archive.json']) {
    const root = empty(t);
    mkdirSync(join(root, 'tasks'));
    writeStore(root, name, [task(800, { status: name === 'done.json' ? 'done' : 'cancelled', extension: 9 })]);
    const before = readFileSync(join(root, 'tasks', name));
    assert.equal(validateProject(root).counter, 800);
    assert.equal(existsSync(join(root, 'tasks/active.json')), false);
    assert.equal(createTask(root, { title: 'Next' }).id, 801);
    assert.deepEqual(readFileSync(join(root, 'tasks', name)), before);
  }
});

test('existing records are readable without metadata; invalid data never receives certification', (t) => {
  const root = empty(t);
  mkdirSync(join(root, 'tasks'));
  writeStore(root, 'active.json', [task(7, { extension: 'kept' })]);
  const bytes = readFileSync(join(root, 'tasks/active.json'));
  assert.equal(getTask(root, 7).extension, 'kept');
  assert.deepEqual(state(root), {});
  assert.equal(validateProject(root).counter, 7);
  assert.deepEqual(readFileSync(join(root, 'tasks/active.json')), bytes);
  const invalid = empty(t);
  mkdirSync(join(invalid, 'tasks'));
  writeFileSync(join(invalid, 'tasks/active.json'), '[broken');
  assert.throws(() => validateProject(invalid), { code: 'INVALID_JSON' });
  assert.deepEqual(state(invalid), {});
  assert.equal(readFileSync(join(invalid, 'tasks/active.json'), 'utf8'), '[broken');
});

test('configured standard stores remain lazy while configuration and extension fields survive', (t) => {
  const root = empty(t);
  mkdirSync(join(root, 'docs'));
  const config = JSON.stringify({ extension: true, default_status: 'todo', stores: {
    'active.json': { statuses: ['todo'] }, 'done.json': { statuses: ['finished'] }, 'archive.json': { statuses: ['deleted'] },
  } });
  writeFileSync(join(root, 'docs/task-schema.json'), config);
  createTask(root, { title: 'Configured' });
  assert.equal(validateProject(root).counter, 1);
  transitionTask(root, 1, 'finished');
  deleteTask(root, 1);
  assert.equal(readFileSync(join(root, 'docs/task-schema.json'), 'utf8'), config);
  assert.equal(getTask(root, 1, { group: 'Archive' }).status, 'deleted');
});

test('help, removed setup command and syntax errors never prepare projects', (t) => {
  const root = empty(t);
  for (const args of [['--help'], ['list', '--help'], ['get-many', '--help'], ['get'], ['list', '--limit', 'invalid'], ['create'], ['init']]) {
    const result = execute(process.execPath, [entry, ...args], root);
    assert.equal(result.status, args.includes('--help') ? 0 : 1, result.stderr);
    assert.deepEqual(readdirSync(root), []);
  }
});

test('destination rollback preserves concurrent edits and replacements but removes its unchanged file', (t) => {
  for (const change of ['edit', 'replace', 'unchanged']) {
    const root = empty(t);
    const project = mutationProject(openProject(root));
    const path = join(root, 'tasks/done.json');
    const external = change === 'replace' ? '[]\n' : JSON.stringify([task(99, { status: 'done' })]);
    assert.throws(() => withProjectLock(project, 'test', () => withDestination(project, 'done', undefined, () => {
      if (change === 'edit') writeFileSync(path, external);
      if (change === 'replace') {
        const replacement = join(root, 'replacement.json');
        writeFileSync(replacement, external);
        renameSync(replacement, path);
      }
      throw Object.assign(new Error('manual edit detected'), { code: 'PROJECT_CHANGED' });
    })), { code: 'PROJECT_CHANGED' });
    if (change === 'unchanged') assert.equal(existsSync(path), false);
    else assert.equal(readFileSync(path, 'utf8'), external);
  }
});

test('invalid all/store combinations fail before preparation through CLI, scripts and core', (t) => {
  for (const command of ['list', 'get']) {
    const root = empty(t);
    const id = command === 'get' ? ['1'] : [];
    const options = [...id, '--store', 'all', '--store', 'active'];
    for (const args of [[entry, command, ...options],
      [fileURLToPath(new URL(`../scripts/${command === 'list' ? 'list-tasks' : 'get-task'}.mjs`, import.meta.url)), ...options]]) {
      const result = execute(process.execPath, args, root);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^INVALID_INPUT: all must be the only requested store/);
      assert.deepEqual(readdirSync(root), []);
    }
    const operation = command === 'list' ? () => listTasks(root, { stores: ['all', 'active'] })
      : () => getTask(root, 1, { stores: ['all', 'active'] });
    assert.throws(operation, { code: 'INVALID_INPUT' });
    assert.deepEqual(readdirSync(root), []);
  }
});
