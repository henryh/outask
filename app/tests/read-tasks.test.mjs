import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { getTask, listTasks } from '../src/tasks.mjs';
import { detail, fixture, list, run, snapshot, task, writeStore } from './fixtures.mjs';

test('standalone list/detail/history reads are bounded and preserve existing-format file bytes', (context) => {
  const root = fixture(context);
  const before = snapshot(root);
  const page = list(root, '--format', 'json');
  const envelope = JSON.parse(page.stdout);
  const rows = envelope.tasks;
  assert.equal(envelope.hasMore, true);
  assert.equal(envelope.nextOffset, 10);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'title', 'status']);
  assert.ok(page.stdout.length < 2000);
  assert.equal(page.stderr, '');
  assert.deepEqual(JSON.parse(list(root, '--offset', '10', '--format', 'json').stdout).tasks.map((row) => row.id), [11, 12]);
  assert.equal(list(root, '--limit', '1', '--offset', '100', '--count').stdout, '12\n');
  const chosen = JSON.parse(detail(root, 12, '--fields', 'id,scope', '--format', 'json').stdout);
  assert.equal(chosen.id, 12);
  assert.match(chosen.scope, /Private task details/);
  assert.deepEqual(Object.keys(chosen), ['id', 'scope']);
  assert.equal(list(root, '--group', 'Done', '--format', 'ids').stdout, '99\n');
  assert.equal(JSON.parse(detail(root, 99, '--store', 'done', '--format', 'json').stdout).status, 'done');
  assert.equal(JSON.parse(list(root, '--store', 'all', '--limit', '50', '--format', 'json').stdout).tasks.length, 13);
  assert.deepEqual(snapshot(root), before);
});

test('minimum records and opaque project fields survive projection and detail reads', (context) => {
  const extension = { type: 'epic', parent: 'outside:99', reference: { path: '/missing/project', id: 1 }, store: 'user data', toString: 'human label' };
  const root = fixture(context, [task(1), task(2, extension)]);
  const before = snapshot(root);
  assert.deepEqual(getTask(root, 1), task(1));
  assert.deepEqual(getTask(root, 2), task(2, extension));
  assert.deepEqual(listTasks(root, { fields: ['id', 'parent', 'reference'] }).tasks, [
    { id: 1 }, { id: 2, parent: extension.parent, reference: extension.reference },
  ]);
  assert.deepEqual(listTasks(root, { sort: 'priority' }).tasks.map((row) => row.id), [1, 2]);
  assert.deepEqual(JSON.parse(detail(root, 2, '--format', 'json').stdout), task(2, extension));
  assert.match(list(root, '--fields', 'id,toString', '--format', 'text').stdout, /id: 1\ntoString: \(unset\)/);
  assert.deepEqual(snapshot(root), before);
});

test('status filters are exact and case-sensitive through both public entry points', (context) => {
  const root = fixture(context, [task(1), task(2, { status: 'pending_review' }), task(3, { status: 'Pending' })], {
    stores: { 'active.json': { statuses: ['pending', 'pending_review', 'Pending'] } },
  });
  assert.deepEqual(listTasks(root, { filters: [{ field: 'status', value: 'pending' }] }).tasks.map((row) => row.id), [1]);
  assert.equal(list(root, '--status', 'pending', '--format', 'ids').stdout, '1\n');
  assert.equal(list(root, '--where', 'status=pending', '--format', 'ids').stdout, '1\n');
  assert.equal(list(root, '--status', 'pend', '--count').stdout, '0\n');
  assert.equal(list(root, '--status', 'Pending', '--format', 'ids').stdout, '3\n');
});

test('filters and deterministic priority sorting precede pagination; missing priority is medium', (context) => {
  const root = fixture(context, [
    task(4, { priority: 'low', blockers: [1] }), task(3),
    task(2, { priority: 'medium' }), task(1, { priority: 'high', blockers: [2] }),
  ]);
  assert.deepEqual(listTasks(root, { sort: 'priority' }).tasks.map((row) => row.id), [1, 2, 3, 4]);
  assert.deepEqual(listTasks(root, { sort: 'priority', descending: true }).tasks.map((row) => row.id), [4, 2, 3, 1]);
  assert.equal(list(root, '--sort', 'priority', '--offset', '1', '--limit', '2', '--format', 'ids').stdout, '2 3\n');
  assert.equal(list(root, '--id', '1', '--id', '4', '--where', 'blockers=1', '--format', 'ids').stdout, '4\n');
  assert.equal(list(root, '--where', 'title=TASK', '--count').stdout, '4\n');
  assert.deepEqual(listTasks(root, { sort: 'status', descending: true }).tasks.map((row) => row.id), [1, 2, 3, 4]);
});

test('configured groups span stores and split mixed stores consistently for list and get', (context) => {
  const root = fixture(context, [], {
    stores: {
      'queue.json': { statuses: ['todo', 'doing'], validate: true },
      'mixed.json': { statuses: ['todo', 'shipped'] },
      'cancelled.json': { statuses: ['cancelled'], validate: false },
    },
    groups: { Active: ['todo', 'doing'], Done: ['shipped'], Archive: ['cancelled'] },
    plan: { required_for_statuses: ['doing'] },
  });
  rmSync(join(root, 'tasks/active.json'));
  rmSync(join(root, 'tasks/done.json'));
  writeStore(root, 'queue.json', [task(1, { status: 'todo' })]);
  writeStore(root, 'mixed.json', [task(2, { status: 'todo' }), task(3, { status: 'shipped' })]);
  writeStore(root, 'cancelled.json', [task(4, { status: 'cancelled' })]);
  writeFileSync(join(root, 'tasks/.task-tracker.json'), 'unreadable allocation metadata: not task JSON');
  const before = snapshot(root);
  assert.equal(list(root, '--format', 'ids').stdout, '1 2\n');
  assert.equal(list(root, '--group', 'Done', '--format', 'ids').stdout, '3\n');
  assert.equal(list(root, '--group', 'Archive', '--format', 'ids').stdout, '4\n');
  assert.equal(list(root, '--store', 'all', '--format', 'ids').stdout, '1 2 3 4\n');
  assert.equal(list(root, '--store', 'queue,mixed', '--store', 'queue', '--format', 'ids').stdout, '1 2 3\n');
  assert.equal(getTask(root, 3, { group: 'Done' }).status, 'shipped');
  assert.throws(() => getTask(root, 3), { code: 'TASK_NOT_FOUND' });
  assert.equal(detail(root, 4, '--group', 'Archive', '--format', 'ids').stdout, '4\n');
  assert.deepEqual(snapshot(root), before);
});

test('legacy store configuration works without group or record migration', (context) => {
  const root = fixture(context, [task(1, { status: 'waiting' })], {
    stores: {
      'active.json': { statuses: ['waiting', 'doing'] },
      'done.json': { statuses: ['done'] },
      'archive.json': { statuses: ['archived'], validate: false },
    },
  });
  writeStore(root, 'archive.json', [task(100, { status: 'archived' })]);
  assert.equal(list(root, '--format', 'ids').stdout, '1\n');
  assert.equal(list(root, '--group', 'Archive', '--format', 'ids').stdout, '100\n');
  assert.equal(getTask(root, 100, { stores: ['archive'] }).status, 'archived');
});

test('unconfigured retained files and standard Archive remain explicitly readable', (context) => {
  const root = fixture(context, [task(1)]);
  writeStore(root, 'retained.json', [task(100, { status: 'old' })]);
  writeStore(root, 'archive.json', [task(101, { status: 'cancelled' })]);
  assert.equal(list(root, '--format', 'ids').stdout, '1\n');
  assert.equal(list(root, '--group', 'Archive', '--format', 'ids').stdout, '101\n');
  assert.equal(list(root, '--store', 'all', '--count').stdout, '4\n');
  assert.equal(getTask(root, 100, { stores: ['retained'] }).status, 'old');
});

test('only the explicitly selected project and stores are read, with no link traversal', (context) => {
  const neighbour = fixture(context, [task(800)]);
  const root = fixture(context, [task(1, { reference: { project: neighbour, id: 800 } })]);
  writeFileSync(join(root, 'tasks/done.json'), '{invalid history');
  assert.equal(list(root, '--format', 'ids').stdout, '1\n');
  assert.equal(getTask(root, 1).reference.project, neighbour);
  assert.equal(list(neighbour, '--format', 'ids').stdout, '800\n');
  assert.throws(() => listTasks(root, { stores: ['all'] }), { code: 'INVALID_JSON' });
  const multiple = run('list-tasks', [root, neighbour]);
  assert.equal(multiple.status, 1);
  assert.match(multiple.stderr, /INVALID_INPUT/);
});

test('empty pages retain valid machine output and optional history files are not required', (context) => {
  const root = fixture(context, []);
  rmSync(join(root, 'tasks/done.json'));
  assert.deepEqual(JSON.parse(list(root, '--format', 'json').stdout).tasks, []);
  assert.equal(list(root, '--count').stdout, '0\n');
  assert.deepEqual(JSON.parse(list(root, '--group', 'Archive', '--format', 'json').stdout).tasks, []);
  writeStore(root, 'active.json', [task(1)]);
  const page = list(root, '--offset', '99', '--format', 'json');
  assert.deepEqual(JSON.parse(page.stdout).tasks, []);
  assert.equal(JSON.parse(page.stdout).hasMore, false);
  assert.equal(JSON.parse(page.stdout).nextOffset, null);
  assert.equal(page.stderr, '');
  assert.match(list(root, '--offset', '99').stderr, /no records of 1 matches/);
  assert.equal(list(root, '--limit', '1', '--format', 'ids').stdout, '1\n');
});

test('missing tasks and malformed or unreadable selected stores report actionable errors without writes', (context) => {
  const root = fixture(context, [task(1)]);
  const missing = run('get-task', [root, '99', '--format', 'json']);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /TASK_NOT_FOUND.*99.*--store all/);
  for (const [source, code] of [['{broken', 'INVALID_JSON'], ['{}', 'INVALID_STORE'], ['[null]', 'INVALID_STORE']]) {
    writeFileSync(join(root, 'tasks/active.json'), source);
    const result = run('list-tasks', [root, '--format', 'json']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(`${code}.*active.json`));
    assert.equal(readFileSync(join(root, 'tasks/active.json'), 'utf8'), source);
  }
  rmSync(join(root, 'tasks/active.json'));
  mkdirSync(join(root, 'tasks/active.json'));
  const unreadable = run('list-tasks', [root]);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /READ_ERROR.*active.json.*check/);
});

test('permission-denied reads fail instead of being treated as empty data', { skip: process.platform === 'win32' }, (context) => {
  const root = fixture(context, [task(1)]);
  chmodSync(root, 0o755);
  chmodSync(join(root, 'tasks/active.json'), 0);
  const extra = process.getuid() === 0 ? { uid: 65534, gid: 65534 } : {};
  const result = run('list-tasks', [root, '--format', 'json'], extra);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /READ_ERROR.*active.json.*EACCES/);
});

test('invalid IDs, required read fields and duplicate selected IDs are rejected', (context) => {
  const root = fixture(context, [task(1)]);
  for (const invalid of [task(0), task(Number.MAX_SAFE_INTEGER + 1), task(1, { title: '' }), task(1, { status: '' })]) {
    writeStore(root, 'active.json', [invalid]);
    assert.throws(() => listTasks(root), { code: 'INVALID_STORE' });
  }
  writeStore(root, 'active.json', [task(1), task(1)]);
  assert.throws(() => getTask(root, 1), /duplicate id 1/);
  writeStore(root, 'active.json', [task(99)]);
  assert.throws(() => listTasks(root, { stores: ['all'] }), /duplicate id 99/);
});

test('invalid configuration and missing configured stores cannot produce partial success', (context) => {
  const config = { stores: { 'queue.json': { statuses: ['todo'] } }, groups: { Active: ['todo'] } };
  const root = fixture(context, [], config);
  assert.throws(() => listTasks(root), { code: 'READ_ERROR' });
  const invalidConfigs = [
    { stores: { '../escape.json': { statuses: ['todo'] } } },
    { stores: { '.task-tracker.json': { statuses: ['todo'] } } },
    { stores: { 'active.json': { statuses: [] } } },
    { stores: { 'active.json': { statuses: ['todo'], validate: 'false' } } },
    { ...config, groups: { Active: ['todo'], Done: ['todo'] } },
    { ...config, groups: { Active: ['missing'] } },
    { ...config, groups: {} },
    { ...config, plan: { required_for_statuses: 'todo' } },
  ];
  for (const invalid of invalidConfigs) {
    writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify(invalid));
    assert.throws(() => listTasks(root), { code: 'INVALID_CONFIG' });
  }
  writeFileSync(join(root, 'docs/task-schema.json'), '{broken');
  assert.throws(() => listTasks(root), { code: 'INVALID_JSON' });
});

test('reusable operations reread manual changes and reject invalid selection/query input', (context) => {
  const root = fixture(context, [task(1)]);
  assert.equal(getTask(root, 1).title, 'Task 1');
  writeStore(root, 'active.json', [task(1, { title: 'Edited manually' })]);
  assert.equal(getTask(root, 1).title, 'Edited manually');
  for (const options of [
    null, [], 'invalid',
    { limit: -1 }, { offset: 1.5 }, { ids: [0] }, { descending: 'true' },
    { fields: [] }, { fields: ['typo'] }, { fields: ['all', 'id'] },
    { filters: [{ field: 'id', value: 1 }] }, { stores: ['../active'] },
    { stores: ['active'], group: 'Active' }, { group: 'typo' }, { stores: ['all', 'active'] },
  ]) assert.throws(() => listTasks(root, options), { code: 'INVALID_INPUT' });
  assert.throws(() => listTasks(), { code: 'INVALID_INPUT' });
  assert.throws(() => listTasks(join(root, 'missing')), { code: 'PROJECT_NOT_FOUND' });
  assert.throws(() => getTask(root, 0), { code: 'INVALID_INPUT' });
  assert.throws(() => getTask(root, 1, null), { code: 'INVALID_INPUT' });
});

test('manual status typos are reported instead of silently hiding tasks from their group', (context) => {
  const root = fixture(context, [task(1, { status: 'pendnig' })]);
  const result = run('list-tasks', [root, '--format', 'json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_STORE.*status pendnig.*expected pending/);
  assert.throws(() => getTask(root, 1), { code: 'INVALID_STORE' });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({
    stores: { 'active.json': { statuses: ['pending'], validate: false } },
  }));
  assert.equal(getTask(root, 1, { stores: ['active'] }).status, 'pendnig');
});

test('script arguments and output formats retain clean stdout and useful errors', (context) => {
  const root = fixture(context, [task(1, { title: 'A multiline\ntitle with long text' })]);
  const table = list(root, '--format', 'table', '--max-width', '10');
  assert.equal(table.stdout.trim().split('\n').length, 2);
  assert.match(table.stdout, /…/);
  assert.match(detail(root, 1, '--fields', 'id,title').stdout, /id: 1/);
  assert.equal(detail(root, 1, '--fields', 'title', '--format', 'ids').stdout, '1\n');
  for (const args of [[root, '--limit', '-1'], [root, '--offset='], [root, '--where', 'bad'], [root, '--fields='], [root, '--unknown'], [root, '--format=xml']]) {
    const result = run('list-tasks', args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /INVALID_INPUT/);
  }
  for (const name of ['list-tasks', 'get-task']) {
    const help = run(name, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /\[project-path\]/);
    assert.equal(help.stderr, '');
  }
});

test('standalone commands own their arguments and use the caller-selected project', (context) => {
  const root = fixture(context, [task(1)]);
  const commands = [
    { name: 'list-tasks', args: ['.'], expected: [task(1)], invalid: ['.', '1'] },
    { name: 'get-task', args: ['.', '1'], expected: task(1), invalid: ['.', '1', '--count'] },
  ];
  for (const { name, args, expected, invalid } of commands) {
    const result = run(name, [...args, '--format', 'json'], { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(name === 'list-tasks' ? JSON.parse(result.stdout).tasks : JSON.parse(result.stdout), expected);
    assert.equal(result.stderr, '');
    const rejected = run(name, invalid, { cwd: root });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /INVALID_INPUT/);
  }
  const listHelp = run('list-tasks', ['--help']).stdout;
  const getHelp = run('get-task', ['--help']).stdout;
  assert.match(listHelp, /--count/);
  assert.doesNotMatch(getHelp, /--count|--where|--offset/);
  assert.match(getHelp, /get-task\.mjs \[project-path\] <id>/);
});

test('shared selection, output and argument checks work for both commands', (context) => {
  const root = fixture(context, [task(1)]);
  const before = snapshot(root);
  for (const [name, args] of [['list-tasks', [root]], ['get-task', [root, '1']]]) {
    const table = run(name, [...args, '--fields', 'id,title', '--format', 'table']);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /^id\s+title\n1\s+Task 1\n$/);
    if (name === 'list-tasks') assert.match(table.stderr, /Showing records 1-1 of 1 matches/);
    else assert.equal(table.stderr, '');
    const history = run(name, [root, ...(name === 'get-task' ? ['99'] : []), '--group', 'Done', '--format', 'ids']);
    assert.equal(history.status, 0, history.stderr);
    assert.equal(history.stdout, '99\n');
    for (const flags of [
      ['--format', 'xml'], ['--max-width', '9'], ['--fields', ''],
      ['--store', 'active', '--group', 'Done'],
    ]) {
      const rejected = run(name, [...args, ...flags]);
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, '');
      assert.match(rejected.stderr, /INVALID_INPUT/);
    }
  }
  assert.deepEqual(snapshot(root), before);
});
